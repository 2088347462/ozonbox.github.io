# OZON工具盒子 🧰

一个专为 OZON 俄罗斯跨境卖家打造的全栈工具平台，集成 AI 生产力、数据分析、实用工具与自研浏览器插件，帮助团队高效完成选品、内容创作与店铺运营。

---

## 📌 项目特色

- **一站式工具矩阵**：主页聚合 AI、数据、实用工具与插件资源，提供一致的交互体验。
- **AI 深度集成**：核心标题生成器支持 DeepSeek Chat，大量内置提示词与多场景生成模版。
- **专业数据分析**：Excel 数据分析器支持多条件筛选、字段联动与可视化结果导出。
- **媒体抓取服务**：后端提供网页渲染、媒体链接提取与下载代理，适配跨站抓取需求。
- **验证码兜底方案**：检测到风控后自动降级为可见浏览器，允许人工完成验证码。
- **插件配套体系**：内置 30 天试用版与永久版插件包，提供后台实时监控与数据洞察。

---

## 🧱 目录结构概览

```
ozpl-new/
├── index.html                    # 入口主页（导航、英雄区、工具总览）
├── pages/                        # 各独立功能页
│   ├── ai-tools.html             # AI 工具聚合页
│   ├── title-generator.html      # 标题/描述/标签生成器（DeepSeek）
│   ├── excel-data-analyzer.html  # Excel 数据分析器
│   ├── tools.html                # 实用工具集合
│   ├── web-sniffer-tool.html     # 嗅探与下载工具
│   ├── performance-fix.css       # 共用性能优化样式
│   └── data/                     # 选品攻略与日历 JSON 数据
├── images/                       # 静态图片与 logo、引导素材
├── plugin/                       # 浏览器插件资源（含 icons/）
├── videos/                       # 演示或宣传视频
├── server.js                     # Node.js 静态资源 & API 服务端
├── package.json / package-lock.json
└── README.md
```

运行时会自动创建 `saved_pages/` 用于存档被抓取的页面源码。

---

## ⚙️ 技术栈

- **前端**：原生 HTML5 / CSS3 / JavaScript，配合 Font Awesome 与 Google Fonts。
- **数据展示**：局部使用表格、图表与 JSON 配置驱动的选品攻略。
- **后端**：Node.js 原生 HTTP 服务（`server.js`）。
- **无头浏览器**：`puppeteer-core`，需配合本地 Chrome / Edge 115+ 可执行文件。
- **AI 能力**：DeepSeek Chat API（用户需自备密钥，在页面本地输入）。

---

## 🚀 快速开始

### 1. 环境要求

- Node.js 18+（与 `puppeteer-core@22` 兼容）。
- Windows 上需安装 Chrome 或 Edge，推荐保持最新稳定版。
  - 服务端会依次检测：
    - `C:\Program Files\Google\Chrome\Application\chrome.exe`
    - `C:\Program Files (x86)\Google\Chrome\Application\chrome.exe`
    - `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe`
    - Edge 安装目录下的 `msedge.exe`
  - 如安装路径不在上述列表，可在 `server.js` 的 `findChromeExecutable()` 中补充。

### 2. 安装依赖

```bash
npm install
```

### 3. 启动服务

```bash
npm start
# 或
node server.js
```

服务默认监听 `http://localhost:3000`，浏览器访问即可使用主页与各功能页。

---

## 🔌 后端接口说明

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/extract-media` | POST | 根据传入 URL 抓取页面，提取图片/视频直链。支持 `render` 参数控制是否调用 Puppeteer 渲染；对拼多多等站点默认启用渲染。抓取成功后会将页面源码保存到 `saved_pages/`。 |
| `/api/download` | GET | 代理下载远程媒体，解决跨域与防盗链问题。需要提供 `url` 查询参数，可选 `filename`。|
| `/api/interactive/continue` | POST | 预留用于验证码完成后的继续抓取（当前逻辑仍在施工，默认返回 404）。|

### 验证码处理流程

当 `detectCaptcha()` 识别到验证码或安全页面时：
1. 自动关闭无头实例。
2. 启动可见浏览器（`headless: false`），生成会话 `sid`。
3. 将 `sid` 返回给前端，用户可在真实浏览器窗口手动完成验证。
4. 5 分钟无操作会自动回收进程。

---

## 🤖 DeepSeek API 使用指南

- 在 `pages/title-generator.html` 顶部的「AI 模型配置」中输入 `sk-` 开头的 DeepSeek API Key。
- 密钥仅缓存在浏览器 `localStorage`，不会上传至服务器。
- 若未填写密钥，调用 DeepSeek 的功能会提示错误，可切换到模拟分析模式继续体验。

---

## 📊 核心功能模块一览

- **AI 标题生成器**：生成标题、简介、关键词、标签与竞品分析报告，支持多平台链接批量输入。
- **Excel 数据分析器**：拖拽上传表格，按价格、品牌、利润等维度筛选，并可导出结果。
- **物流计算器 / 水印工具 / 嗅探工具**：提供日常运营所需的常用小工具。
- **节日&主题选品模板**：`pages/data/*.json` 提供多类选品策略，前端页面动态渲染。
- **浏览器插件**：`ozon-sales-assistant-30day-trial.zip`、`ozon-sales-assistant-by-nicole-permanent.zip` 可直接在 Chrome 扩展管理界面加载。

---

## 🔒 安全与隐私

- 所有 API Key 与用户输入仅存储在浏览器本地，不会写入服务器文件。
- 服务器端日志仅记录抓取请求的目标 URL 与异常信息，可按需在 `server.js` 中关闭或重定向。
- 下载代理默认强制内容保存为附件，防止浏览器内联执行未知脚本。

---

## 🛣️ 路线图 & 已知事项

- 🔄 `/api/interactive/continue` 后续将补充实际逻辑（当前返回 404）。
- 🧮 批量 SKU 生成、图片批量处理功能仍处于页面占位阶段。
- 🌐 如需在 Linux / macOS 部署，请确认 Chrome 可执行文件路径，并将其加入 `findChromeExecutable()`。

欢迎通过 Issue 或邮件提交需求与反馈。

---

## 📝 更新日志

### v2.3.0（当前）
- 🤖 新增 DeepSeek AI 模型集成与多平台竞品分析。
- 📦 插件打包支持永久版与 30 天试用版。
- 📊 增强 Excel 数据分析器，支持更多筛选维度。
- 🔍 增加智能搜索与性能优化样式，提升页面响应速度。
- 🛡️ 引入下载代理与验证码交互式兜底机制。

---

## 📞 联系我们

- 邮箱：`zouqifeng@jiawae-commerce.com`
- 工作时间：周一至周五 09:00-18:00
- 技术支持：主页右下角客服入口

© 2025 Made By Nicole. All rights reserved.

> OZON 工具盒子 —— 让跨境运营更简单、更高效！