const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');
const puppeteer = require('puppeteer-core');

const PORT = process.env.PORT || 3000;

// 新增：交互式会话存储（用于验证码人工验证）
const interactiveSessions = new Map();

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.zip': 'application/zip'
};

const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // 处理API请求
    if (pathname === '/api/extract-media' && req.method === 'POST') {
        handleExtractMedia(req, res);
        return;
    }
    if (pathname === '/api/extract-media' && req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    // 新增：交互式继续抓取
    if (pathname === '/api/interactive/continue' && req.method === 'POST') {
        handleInteractiveContinue(req, res);
        return;
    }
    if (pathname === '/api/interactive/continue' && req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }
    // 新增下载代理
    if (pathname === '/api/download' && req.method === 'GET') {
        handleDownload(req, res, parsedUrl.query);
        return;
    }
    
    // 处理静态文件
    let filePath = '.' + pathname;
    
    // 如果请求根路径，默认返回index.html
    if (filePath === './') {
        filePath = './index.html';
    }
    
    // 如果没有扩展名，尝试添加.html
    if (path.extname(filePath) === '') {
        filePath += '.html';
    }
    
    const extname = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // 文件不存在，返回404
                res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end('<h1>404 - 页面未找到</h1>');
            } else {
                // 服务器错误
                res.writeHead(500);
                res.end('服务器内部错误');
            }
        } else {
            // 成功返回文件
            res.writeHead(200, { 'Content-Type': contentType + '; charset=utf-8' });
            res.end(content);
        }
    });
});

// 处理媒体提取API
function handleExtractMedia(req, res) {
    let body = '';
    
    req.on('data', chunk => {
        body += chunk.toString();
    });
    
    req.on('end', async () => {
        try {
            const { url: targetUrl, type, render } = JSON.parse(body);
            console.log(`[extract-media] 收到请求: url=${targetUrl}, type=${type}, render=${!!render}`);
            
            if (!targetUrl) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: '缺少URL参数' }));
                return;
            }
            
            try {
                const html = await fetchPageWithRender(targetUrl, !!render);
                
                // 先把网页下载（保存）到本地，再从中获取图片/视频
                try {
                    const host = (() => { try { return new URL(targetUrl).hostname.replace(/[^a-z0-9.-]/gi, '_'); } catch { return 'page'; } })();
                    const dir = path.join(__dirname, 'saved_pages');
                    const fname = `${Date.now()}_${host}.html`;
                    fs.mkdirSync(dir, { recursive: true });
                    fs.writeFileSync(path.join(dir, fname), html || '', 'utf8');
                    console.log(`[extract-media] 页面已保存: ${path.join('saved_pages', fname)}`);
                } catch (e) {
                    console.warn('[extract-media] 保存页面失败:', e?.message);
                }
                
                const mediaFiles = parseMediaFromHtml(html, targetUrl, type || 'all');
                console.log(`[extract-media] 提取完成: 数量=${mediaFiles.length}`);
                
                res.writeHead(200, { 
                    'Content-Type': 'application/json; charset=utf-8',
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type'
                });
                res.end(JSON.stringify({ mediaFiles }));
            } catch (e) {
                // 捕获需要人工验证的信号
                if (e && e.code === 'REQUIRE_VERIFICATION' && e.sid) {
                    res.writeHead(200, { 
                        'Content-Type': 'application/json; charset=utf-8',
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    });
                    res.end(JSON.stringify({ requireVerification: true, sid: e.sid, message: e.message || '检测到验证码，请在弹出的浏览器窗口中完成验证后继续。' }));
                    return;
                }
                throw e;
            }
            
        } catch (error) {
            console.error('[extract-media] 失败:', error);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: '提取媒体文件失败: ' + error.message }));
        }
    });
}

// 使用渲染或直连获取HTML
async function fetchPageWithRender(targetUrl, render) {
    const hostname = (() => { try { return new URL(targetUrl).hostname; } catch { return ''; } })();
    const isPdd = /yangkeduo\.com|pinduoduo\.com/i.test(hostname);
    const needRender = render || isPdd; // 对拼多多默认启用渲染
    if (!needRender) return await fetchPage(targetUrl);
    try {
        return await renderPage(targetUrl, { interactiveOnCaptcha: true });
    } catch (e) {
        if (e && e.code === 'REQUIRE_VERIFICATION') throw e; // 让上层返回交互式验证
        console.warn('[render] 渲染失败，回退到直连抓取:', e?.message);
        return await fetchPage(targetUrl);
    }
}

// 从URL提取页面内容（支持重定向与压缩）
async function fetchPage(targetUrl, redirectCount = 0) {
    if (redirectCount > 5) throw new Error('重定向过多');
    return new Promise((resolve, reject) => {
        const urlObj = new URL(targetUrl);
        const client = urlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'Host': urlObj.host,
                'Referer': targetUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Upgrade-Insecure-Requests': '1',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Connection': 'close',
                'Cache-Control': 'no-cache'
            }
        };

        const req = client.request(options, (res) => {
            // 处理重定向
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const location = res.headers.location.startsWith('http')
                    ? res.headers.location
                    : new URL(res.headers.location, targetUrl).toString();
                res.resume();
                fetchPage(location, redirectCount + 1).then(resolve).catch(reject);
                return;
            }

            if (res.statusCode < 200 || res.statusCode >= 300) {
                reject(new Error(`请求失败，状态码: ${res.statusCode}`));
                res.resume();
                return;
            }

            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const encoding = (res.headers['content-encoding'] || '').toLowerCase();
                try {
                    if (encoding.includes('br')) {
                        zlib.brotliDecompress(buffer, (err, out) => {
                            if (err) return reject(err);
                            resolve(out.toString('utf8'));
                        });
                    } else if (encoding.includes('gzip')) {
                        zlib.gunzip(buffer, (err, out) => {
                            if (err) return reject(err);
                            resolve(out.toString('utf8'));
                        });
                    } else if (encoding.includes('deflate')) {
                        zlib.inflate(buffer, (err, out) => {
                            if (err) return reject(err);
                            resolve(out.toString('utf8'));
                        });
                    } else {
                        resolve(buffer.toString('utf8'));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('请求超时')); });
        req.end();
    });
}

// 通过无头浏览器渲染以应对强JS渲染与反爬
async function renderPage(targetUrl, options = {}) {
    const execPath = findChromeExecutable();
    if (!execPath) throw new Error('未找到本机 Chrome/Edge 可执行文件');
    const browser = await puppeteer.launch({
        executablePath: execPath,
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Mobile Safari/537.36');
        await page.setViewport({ width: 414, height: 896, deviceScaleFactor: 2, isMobile: true });
        await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });
        // 反自动化指纹
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            // 伪造常见属性
            window.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
        });
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        // await page.waitForTimeout(1500);
        await new Promise(r => setTimeout(r, 1500));
        const html = await page.content();

        // 检测验证码/安全页
        const { detected, reason } = detectCaptcha(html, targetUrl);
        if (detected && options.interactiveOnCaptcha) {
            console.warn('[captcha] 检测到可能的验证码/安全验证:', reason);
            // 关闭无头实例，启动可见浏览器供用户手动验证
            try { await browser.close(); } catch {}
            const sid = await startInteractiveSession(targetUrl);
            const err = new Error('需要人工验证: ' + (reason || '验证码'));
            err.code = 'REQUIRE_VERIFICATION';
            err.sid = sid;
            throw err;
        }

        return html;
    } finally {
        // 如果已在上面关闭，这里可能报错，忽略
        try { await browser.close(); } catch {}
    }
}

function findChromeExecutable() {
    const candidates = [
        // Chrome
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe') : null,
        // Edge
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
    ].filter(Boolean);
    for (const p of candidates) {
        try { if (fs.existsSync(p)) return p; } catch {}
    }
    return null;
}

// 从HTML中解析媒体文件（支持 src / srcset / data-* / og:image 等）
function parseMediaFromHtml(html, baseUrl, type) {
    try {
        const imagesExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.avif'];
        const videosExt = ['.mp4', '.webm', '.ogg', '.m3u8', '.ts', '.mov', '.avi', '.mkv', '.flv', '.wmv'];

        const isImageExt = (p) => imagesExt.some(e => p.toLowerCase().includes(e));
        const isVideoExt = (p) => videosExt.some(e => p.toLowerCase().includes(e));

        const baseHref = getBaseHref(html);
        const base = (() => {
            try {
                const b = baseHref ? new URL(baseHref, baseUrl).toString() : baseUrl;
                return b;
            } catch {
                return baseUrl;
            }
        })();

        const results = [];
        const seen = new Set();

        const ensureAbs = (link) => {
            if (!link) return null;
            let u = link.trim().replace(/^['\"]|['\"]$/g, '');
            u = u.replace(/^url\((.*)\)$/i, '$1').replace(/^['\"]|['\"]$/g, '');
            if (!u || u.startsWith('data:') || u.startsWith('blob:')) return null;
            try {
                const abs = new URL(u, base).toString();
                return abs;
            } catch { return null; }
        };

        const inferType = (abs, hint) => {
            if (hint) return hint;
            const low = abs.toLowerCase();
            if (isImageExt(low)) return 'image';
            if (isVideoExt(low)) return 'video';
            // 常见图片直链参数中包含imageView等
            if (/imageView|imageMogr|x-oss-process=image|format=webp/.test(low)) return 'image';
            return 'image'; // 默认按图片处理，避免漏图
        };

        const passTypeFilter = (t) => {
            if (!type || type === 'all') return true;
            if (type === 'images') return t === 'image';
            if (type === 'videos') return t === 'video';
            return true;
        };

        const add = (u, hint) => {
            const abs = ensureAbs(u);
            if (!abs) return;
            if (seen.has(abs)) return;
            const t = inferType(abs, hint);
            if (!passTypeFilter(t)) return;
            seen.add(abs);
            const pathname = (() => { try { return new URL(abs).pathname; } catch { return ''; } })();
            let filename = path.basename(pathname) || (t === 'image' ? 'image' : 'video');
            // 简单清理文件名中的查询符
            filename = filename.replace(/[?#].*$/, '');
            if (!filename) filename = t === 'image' ? 'image' : 'video';
            const media = {
                type: t,
                url: abs,
                filename,
                size: '—'
            };
            if (t === 'image') media.dimensions = '—';
            if (t === 'video') media.duration = '—';
            results.push(media);
        };

        // 1) <img src>
        try {
            const imgSrcRe = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/ig;
            let m;
            while ((m = imgSrcRe.exec(html)) !== null) add(m[1], 'image');
        } catch {}

        // 2) <img srcset>
        try {
            const imgSetRe = /<img[^>]*\ssrcset=["']([^"']+)["'][^>]*>/ig;
            let m;
            while ((m = imgSetRe.exec(html)) !== null) {
                const list = m[1].split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
                list.forEach(u => add(u, 'image'));
            }
        } catch {}

        // 3) 背景图：内联style属性
        try {
            const bgRe = /style=["'][^"']*background(?:-image)?\s*:\s*url\(([^)]+)\)[^"']*["']/ig;
            let m;
            while ((m = bgRe.exec(html)) !== null) add(m[1], 'image');
        } catch {}

        // 4) OpenGraph / Twitter 预览图与视频
        try {
            const metaRe1 = /<meta[^>]+(?:property|name)=["'](?:og:image|og:video|og:video:url|twitter:image|twitter:image:src|twitter:player:stream)["'][^>]*content=["']([^"']+)["'][^>]*>/ig;
            let m;
            while ((m = metaRe1.exec(html)) !== null) {
                const u = m[1];
                const hint = /video/.test(m[0]) || isVideoExt(u) ? 'video' : 'image';
                add(u, hint);
            }
            const metaRe2 = /<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|og:video|og:video:url|twitter:image|twitter:image:src|twitter:player:stream)["'][^>]*>/ig;
            while ((m = metaRe2.exec(html)) !== null) {
                const u = m[1];
                const hint = /video/.test(m[0]) || isVideoExt(u) ? 'video' : 'image';
                add(u, hint);
            }
        } catch {}

        // 5) <video src> 与 <source src>
        try {
            const v1 = /<video[^>]*\ssrc=["']([^"']+)["'][^>]*>/ig;
            const v2 = /<source[^>]*\ssrc=["']([^"']+)["'][^>]*>/ig;
            let m;
            while ((m = v1.exec(html)) !== null) add(m[1], 'video');
            while ((m = v2.exec(html)) !== null) add(m[1], 'video');
        } catch {}

        // 6) <a href> 直链媒体
        try {
            const aRe = /<a[^>]*\shref=["']([^"']+)["'][^>]*>/ig;
            let m;
            while ((m = aRe.exec(html)) !== null) {
                const u = m[1];
                const abs = ensureAbs(u);
                if (!abs) continue;
                const low = abs.toLowerCase();
                if (isImageExt(low)) add(abs, 'image');
                else if (isVideoExt(low)) add(abs, 'video');
            }
        } catch {}

        // 7) <script type="application/ld+json"> JSON-LD
        try {
            const ldRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/ig;
            let m;
            while ((m = ldRe.exec(html)) !== null) {
                try {
                    const jsonText = m[1].trim();
                    if (!jsonText) continue;
                    const obj = JSON.parse(jsonText);
                    collectJsonMedia(obj, add);
                } catch {}
            }
        } catch {}

        // 8) <script> 文本中的直链媒体（兜底）
        try {
            const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/ig;
            let m;
            while ((m = scriptRe.exec(html)) !== null) {
                const text = m[1];
                const urls = text.match(/https?:\/\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]+/g) || [];
                urls.forEach(u => {
                    const low = u.toLowerCase();
                    if (isImageExt(low)) add(u, 'image');
                    else if (isVideoExt(low)) add(u, 'video');
                });
            }
        } catch {}

        return results;
    } catch (e) {
        console.warn('parseMediaFromHtml 出错:', e?.message);
        return [];
    }
}

function getBaseHref(html) {
    try {
        const m = html.match(/<base[^>]+href=["']([^"']+)["'][^>]*>/i);
        return m ? m[1] : null;
    } catch { return null; }
}

function collectJsonMedia(obj, add) {
    const visit = (node) => {
        if (!node) return;
        if (Array.isArray(node)) {
            node.forEach(visit);
            return;
        }
        if (typeof node === 'object') {
            // image 字段
            if (node.image) {
                if (typeof node.image === 'string') add(node.image, 'image');
                else if (Array.isArray(node.image)) node.image.forEach(i => typeof i === 'string' && add(i, 'image'));
                else if (typeof node.image === 'object' && node.image.url) add(node.image.url, 'image');
            }
            // video 或 contentUrl
            if (node.video) {
                if (typeof node.video === 'string') add(node.video, 'video');
                else if (Array.isArray(node.video)) node.video.forEach(v => typeof v === 'string' && add(v, 'video'));
                else if (typeof node.video === 'object' && node.video.contentUrl) add(node.video.contentUrl, 'video');
            }
            if (node.contentUrl && typeof node.contentUrl === 'string') add(node.contentUrl, 'video');
            Object.values(node).forEach(visit);
        }
    };
    visit(obj);
}

// 新增：验证码/安全页检测（简单启发式）
function detectCaptcha(html, targetUrl) {
    try {
        const txt = (html || '').toLowerCase();
        const patterns = [
            '验证码', '安全验证', '请拖动', '滑块', 'geetest', 'recaptcha', 'hcaptcha',
            'are you a robot', 'verify you are human', 'attention required', 'cloudflare',
            '请开启 javascript', 'enable javascript and cookies', '访问过于频繁', '人机验证', '请完成验证'
        ];
        const detected = patterns.some(p => txt.includes(p.toLowerCase()));
        const reason = detected ? (patterns.find(p => txt.includes(p.toLowerCase())) || 'captcha') : '';
        return { detected, reason };
    } catch {
        return { detected: false, reason: '' };
    }
}

// 新增：启动可见浏览器让用户手动验证
async function startInteractiveSession(targetUrl) {
    const execPath = findChromeExecutable();
    if (!execPath) throw new Error('未找到本机 Chrome/Edge 可执行文件');
    const browser = await puppeteer.launch({
        executablePath: execPath,
        headless: false, // 关键：可见窗口，供用户操作
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'
        ]
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8' });
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const sid = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    interactiveSessions.set(sid, { browser, page, targetUrl, createdAt: Date.now() });

    // 超时自动清理（5分钟）
    setTimeout(async () => {
        const s = interactiveSessions.get(sid);
        if (!s) return;
        try { await s.browser.close(); } catch {}
        interactiveSessions.delete(sid);
        console.warn('[interactive] 会话超时已清理:', sid);
    }, 5 * 60 * 1000);

    return sid;
}

// 下载代理：解决跨域与防盗链，直接由服务端拉取并回传
function handleDownload(req, res, query) {
    try {
        const target = query.url;
        const filename = query.filename || undefined;
        if (!target || !/^https?:\/\//i.test(target)) {
            res.writeHead(400, {
                'Content-Type': 'application/json; charset=utf-8',
                'Access-Control-Allow-Origin': '*'
            });
            res.end(JSON.stringify({ error: '缺少或非法的url参数' }));
            return;
        }
        console.log('[download] 代理下载:', target);
        downloadAndPipe(target, res, 0, filename);
    } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: '下载失败: ' + e.message }));
    }
}

function downloadAndPipe(targetUrl, res, redirectCount = 0, filename) {
    if (redirectCount > 5) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: '重定向过多' }));
        return;
    }
    const u = new URL(targetUrl);
    const client = u.protocol === 'https:' ? https : http;
    const options = {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: 'GET',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Referer': `${u.protocol}//${u.host}/`,
            'Connection': 'close'
        }
    };
    const preq = client.request(options, (pres) => {
        if (pres.statusCode >= 300 && pres.statusCode < 400 && pres.headers.location) {
            const next = pres.headers.location.startsWith('http') ? pres.headers.location : new URL(pres.headers.location, targetUrl).toString();
            pres.resume();
            return downloadAndPipe(next, res, redirectCount + 1, filename);
        }
        if (pres.statusCode < 200 || pres.statusCode >= 300) {
            res.writeHead(pres.statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            res.end(JSON.stringify({ error: `上游响应异常: ${pres.statusCode}` }));
            pres.resume();
            return;
        }
        const headers = {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': pres.headers['content-type'] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        };
        const fname = filename || path.basename(u.pathname) || 'download';
        headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(fname)}`;
        if (pres.headers['content-length']) headers['Content-Length'] = pres.headers['content-length'];
        res.writeHead(200, headers);
        pres.pipe(res);
    });
    preq.on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: '下载请求失败: ' + err.message }));
    });
    preq.setTimeout(20000, () => { preq.destroy(new Error('下载超时')); });
    preq.end();
}

server.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log('按 Ctrl+C 停止服务器');
});

// 优雅关闭
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭');
        process.exit(0);
    });
});