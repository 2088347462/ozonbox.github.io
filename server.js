const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

// MIME类型映射
const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
    let filePath = '.' + req.url;
    
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