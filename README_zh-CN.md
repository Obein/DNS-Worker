<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>隐私优先 Protective DNS 解析器 & DoH / DoT 服务端</p>
  <p>保护您的互联网第一跳 · 双引擎架构：Cloudflare Workers 边缘无服务器或独立服务器 / VPS (Linux / macOS / Windows)</p>
  <p align="center">
    <a href="README.md">English</a> | 中文 (简体) | <a href="README_zh-TW.md">中文 (正體)</a>
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js >= 22.5](https://img.shields.io/badge/Runtime-Node.js%20%3E%3D%2022.5-green.svg)](https://nodejs.org/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Protocols: UDP 53 · DoT 853 · DoH](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20853%20%7C%20DoH-brightgreen.svg)](#-双引擎架构与部署特性对比)

</div>

---

## 📖 简介

**DNS Worker** 作为专为隐私与性能 Protective DNS 解析系统，采用**双引擎架构（Dual-Engine Architecture）**。它既可以作为免运维的 Serverless 边缘应用完全运行在 Cloudflare Workers 网络上，也可以**完全脱离 Cloudflare**，在您的自有 VPS、家用服务器或物理机（Linux、macOS、Windows）上以独立服务模式运行，并采用原生 Node.js 内置 SQLite 存储。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

### 什么是 DNS over HTTPS (DoH) 与 DNS over TLS (DoT)？

* **DNS over HTTPS (DoH / RFC 8484)**：通过加密的 HTTP/2 或 HTTP/3 连接进行 DNS 查询。DNS Worker 提供标准 DoH 端点，兼容各大现代浏览器、操作系统及 stub 客户端。
* **DNS over TLS (DoT / RFC 7858)**：在标准 853 端口上通过 TLS 隧道直接加密 DNS 查询。DNS Worker 独立模式原生支持 TLS SNI 配置路由，完美契合 Android 9+ 系统自带的“私有 DNS”（Private DNS）。

---

## ✨ 核心功能

- 🌐 **双引擎自由部署**：支持 Cloudflare Workers 边缘 Serverless 运行，亦可完全脱离 Cloudflare 在自有 VPS/服务器上独立部署。
- ⚡ **全栈协议覆盖**：
  - **经典 UDP 53**：标准 RFC 1035 UDP DNS，路由器与内网设备即插即用。
  - **DoT 853 (DNS over TLS)**：标准 RFC 7858 加密 DNS，支持 SNI Profile 路由（如 `<profile_key>.dns.example.com`），完美契合 Android 原生私有 DNS。
  - **DoH (DNS over HTTPS)**：标准 RFC 8484 加密 DNS，支持 HTTP/2 与 HTTP/3。
- 🚀 **极速解析**：内存与边缘分层加速，纳秒/微秒级响应。
- 🗒️ **多配置管理 (Profiles)**：支持创建多个独立配置，每个配置拥有唯一的端点与规则集合。
- 🛡️ **精细过滤**：
  - **黑/白名单**：支持精确域名及子域名通配符。
  - **第三方规则集**：支持订阅 AdGuard、EasyList、hosts 等格式的外部拦截列表，借助布隆过滤器毫秒级命中。
  - **自定义重定向**：支持 A/AAAA/TXT/CNAME 记录的自定义覆盖。
- 📊 **实时统计与日志**：可视化仪表盘，记录每一次请求的命中原因、地理位置及上游延迟。
- 🔐 **隐私增强**：支持 ECS (EDNS Client Subnet) 灵活配置（透传、自定义或隐藏）。
- 🔒 **重写 ECH & ECH Fronting**：针对 HTTPS (Type 65) / SVCB (Type 64) 查询，自动重写/注入 ECH (Encrypted Client Hello) 参数与自定义表层伪装域名（Outer SNI / ECH Fronting），全程加密真实目标域名以防中间人窥探与阻断。（*注：重写注入功能仅支持由 Cloudflare 代理的域名*）。
- ⚡ **本地优先架构 (Local-First)**：基于浏览器原生 OPFS (Origin Private File System) 与 WebAssembly SQLite 构建。解析日志与统计图表本地 0ms 瞬间渲染，后台双向增量同步，大幅节约数据库读配额且支持断网离线分析。
- 🛡️ **后量子零知识端到端加密 (E2EE)**：支持由硬件通行密钥 (Passkey / WebAuthn) 及恢复密钥保护的端到端日志信封加密。基于 NIST FIPS 203 **P256-MLKEM768** 后量子混合格密码学与周期性小时级 KEM DEK，持久化存储仅存不可逆密文，唯有已授权设备可在本地解密还原。
- 🌗 **现代 UI**：支持暗黑模式，基于 React + BlueprintJS 构建的高密度管理面板。

---

## 🖼️ 界面预览

| 用户登录 | 
|:---:|
| ![用户登录](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-login.webp) | 

| 安装引导 | 端点配置 |
|:---:|:---:|
| ![设置引导](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-setup.webp) | ![端点配置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-endpoints.webp) | 

| 分析统计 | 解析目的地 |
|:---:|:---:|
| ![统计分析](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![解析目的地](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) | 

| 本地规则管理 | 外部拦截列表 |
|:---:|:---:|
| ![规则设置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) | ![过滤列表](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) | 

| 解析日志 | 日志详情 |
|:---:|:---:|
| ![解析日志](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) | ![日志详情](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log_detail.webp) | 

| 配置选项 | 配置选择 |
|:---:|:---:|
| ![高级设置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-settings.webp) | ![配置选择](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-profile_select.webp) | 

| 移动端日志 | 移动端统计 |
|:---:|:---:|
| ![移动端日志](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_log.webp) | ![移动端统计](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) |

---

## 🛠️ 技术架构

### 代码结构

```text
├── src/
│   ├── index.ts          # Cloudflare Worker 入口，处理 HTTP 路由与 DoH
│   ├── serverfull/       # 独立服务器模式入口 (UDP 53, DoT 853, HTTP 3000)
│   │   ├── index.ts      # Serverfull CLI 与主启动引导
│   │   ├── udp.ts        # 经典 RFC 1035 UDP 53 DNS 服务端
│   │   ├── dot.ts        # RFC 7858 DoT 853 服务端 (支持 TLS SNI Profile 路由)
│   │   ├── http.ts       # Web 控制台与 DoH HTTP 服务端
│   │   └── db.ts         # 原生 Node.js SQLite (node:sqlite) 适配器与自动迁移
│   ├── types.ts          # 类型定义
│   ├── api/              # API 控制器 (Auth, Account, Profiles)
│   ├── lib/              # 核心逻辑 (RBAC, 规则过滤, PQC 密码学, DEK 管理器)
│   ├── models/           # 数据库模型 (统一适配 D1 与 SQLite)
│   ├── pipeline/         # DNS 解析流水线 (统一核心业务逻辑)
│   └── utils/            # 工具类 (缓存, GeoIP, DNS 编解码, Bloom 过滤器)
├── web/                  # React/BlueprintJS UI 前端项目 (本地优先 WASM + OPFS)
│   ├── public/           # 公共静态文件
│   ├── src/              # 前端源码
│   │   ├── assets/       # 静态资源 (图片、图标等)
│   │   ├── components/   # 可复用的 UI 组件
│   │   ├── i18n/         # 国际化多语言配置
│   │   ├── layouts/      # 布局组件 (仪表板布局等)
│   │   ├── routes/       # 前端路由配置
│   │   ├── services/     # 统一 API 服务封装 (鉴权、账户、配置文件等)
│   │   ├── views/        # 页面 / 视图 (仪表板、日志、设置、引导等)
│   │   └── utils/        # 工具类及辅助函数
│   └── package.json      # 前端依赖配置
├── static/               # 编译后的静态资源
├── scripts/              # 辅助自动化脚本 (如 Linux systemd 服务生成器)
├── migrations/           # 统一 SQL 数据库迁移脚本
└── wrangler.toml         # Cloudflare 部署配置
```

### 解析流水线 (Resolution Pipeline)

当一个 DNS 请求到达时，它会经过以下处理阶段：

1.  **内存缓存检查**：检查边缘或进程内存中是否存在该查询的有效响应。
2.  **配置加载**：从内存 -> Cache API -> 数据库 (D1 或本地 SQLite) 分层加载 Profile 设置。
3.  **本地规则匹配**：
    - **白名单**：命中则直接转发上游并返回。
    - **重定向**：命中则返回自定义记录。
    - **黑名单**：命中则返回 NXDOMAIN、0.0.0.0 或自定义结果。
4.  **外部列表过滤**：
    - 利用 **Bloom Filter** (布隆过滤器) 进行快速筛选。
5.  **上游解析**：若以上均未命中，则根据配置请求上游 DoH 服务器，并支持 ECS 处理。
6.  **异步日志与缓存**：异步记录解析日志（支持 PQC 零知识端到端加密）、获取目标 GeoIP，并将结果写入各级缓存。

---

## 🚀 部署指南

DNS Worker 提供两种部署形态，满足不同场景的使用需求：
* **方案 A：🖥️ 独立服务器 / VPS 部署 (脱离 Cloudflare, 100% 数据自主)** —— 推荐给追求完全自主可控、家庭路由器直连 UDP 53 及 Android 原生 DoT 853 的自建玩家与企业。
* **方案 B：☁️ Cloudflare Workers 边缘模式 (无服务器, 免运维)** —— 推荐给追求全球 300+ 节点低延迟、零服务器硬件维护成本的个人与团队。

---

### 方案 A：🖥️ 独立服务器 / VPS 部署 (脱离 Cloudflare, 100% 数据自主)

DNS Worker 可完全脱离 Cloudflare Workers，直接在 Linux、Windows、macOS 服务器或虚拟机上以独立服务模式运行，依赖 Node.js `>= 22.5.0` 内置的 `node:sqlite` 引擎。无需任何 Cloudflare 账号、API Token 或外部数据库。

#### 独立模式核心特性
* **经典 UDP DNS (端口 53)**：标准的 RFC 1035 UDP DNS 解析服务，可直接填入路由器 WAN/LAN 或系统 DNS 设置中。
* **DNS over TLS / DoT (端口 853)**：标准的 RFC 7858 加密 DNS，原生支持 Android 9+ 系统自带的“私有 DNS”（Private DNS），并支持通过 SNI（如 `<profile_key>.dns.example.com`）自动路由到指定的 Profile。
* **Web 控制台与 DoH (默认端口 3000)**：全功能 React 管理面板与 REST API，开箱即用。
* **本地 SQLite 数据库**：自动执行迁移脚本初始化表结构，无需任何云端依赖。

#### 环境变量配置 (在 `.env.serverfull`、`.env` 或系统环境变量中配置)

| 环境变量 | 说明 | 默认值 / 示例 |
|---|---|---|
| `SERVERFULL_TLS_KEY_PATH` | TLS 私钥文件路径 (PEM 格式，亦兼容 `SERFULL_TLS_KEY_PATH`) | `/etc/letsencrypt/live/example.com/privkey.pem` |
| `SERVERFULL_TLS_CERT_PATH` | TLS 公钥/证书链文件路径 (PEM 格式，亦兼容 `SERVERFULL_TLS_PUB_PATH`) | `/etc/letsencrypt/live/example.com/fullchain.pem` |
| `SERVERFULL_UDP_PORT` | 经典 UDP DNS 监听端口 | `53` |
| `SERVERFULL_DOT_PORT` | DoT (TLS) 监听端口 | `853` |
| `SERVERFULL_HTTP_PORT` | HTTP Web 面板与 DoH 监听端口 | `3000` |
| `SERVERFULL_HOST` | 监听地址 | `0.0.0.0` |
| `SERVERFULL_DB_PATH` | 本地 SQLite 数据库文件路径 | `./data/dns_worker.sqlite` |
| `SERVERFULL_DEFAULT_PROFILE_KEY` | UDP DNS 或无 SNI 时的默认配置 Profile Key | 首个创建的 Profile |
| `JWT_SECRET` | 会话 Token 加密密钥 | 自定义安全字符串 |

#### 快速启动

1. 克隆代码仓库并安装依赖：
```bash
git clone https://github.com/Obein/DNS-Worker.git DNS-Worker
cd DNS-Worker
npm install
```

2. 配置环境变量：
项目内置提供开箱即用的配置文件模板 `.env.serverfull`。您可以直接修改，也可以复制为 `.env`：
```bash
cp .env.serverfull .env
nano .env
```

3. 编译前端并启动独立服务：
```bash
npm run start:serverfull
```

4. 注册为 Linux 系统常驻服务 (systemd)：
```bash
sudo npm run service-create:linux
sudo systemctl start dns-worker
sudo systemctl status dns-worker
```
该命令会自动生成 `/etc/systemd/system/dns-worker.service`，配置 `CAP_NET_BIND_SERVICE` 特权端口（53/853）绑定能力并配置开机自启。

---

### 方案 B：☁️ Cloudflare Workers 边缘模式 (无服务器, 免运维)

依托 Cloudflare 全球 300+ 个城市的边缘节点网络与 D1 数据库运行，免除所有底层硬件与系统维护。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

#### 1. 线上控制台部署 (Cloudflare Dashboard)

1.  **Fork 本项目**：点击页面右上角的 `Fork` 按钮，将仓库克隆到你的 GitHub 账号下。
2.  **创建 D1 数据库**：登录 Cloudflare 控制台，前往 `Workers & Pages` > `D1`，创建一个新的数据库（例如命名为 `dns_worker_db`），并复制所创建的数据库 ID。
3.  **配置数据库 ID**：在你的 Fork 仓库中，修改 `wrangler.toml` 文件，将 `database_id` 替换为你刚才创建的数据库 ID。
4.  **创建 Worker**：前往 Cloudflare 控制台 `Workers & Pages` > `Create application`。
5.  **从 GitHub 导入并完成首次部署**：在部署页面选择 `Continue with GitHub`，关联你 Fork 的项目并完成授权。在构建与部署设置 (Build & Deploy settings) 中如此填写：
    *   **构建命令**: `npm run build`
    *   **部署命令**: `npm run deploy`
    *   **路径**: `/`
    > ⚠️ **注意**：项目初始化向导中的环境变量仅注入构建容器，运行时的机密变量在初始化向导中填写无效。请直接点击“部署”，待首次部署完成后，按后续步骤在 Worker 设置中填写。
6.  **配置 JWT 密钥**：首次部署完成后，登录 Cloudflare 控制台，前往 `Workers & Pages` > 点击刚才创建的 Worker > `Settings` > `Runtime variables and secrets`（或 `Variables and secrets`） > 点击 `Add`。将变量名称设置为 `JWT_SECRET`，类型选择 `机密 (Secret)`，值中输入一个随机安全字符串，然后点击 `Deploy`（或 `Save and Deploy`）保存。
7.  **配置 KEK 启用信封加密（可选）**：同样在首次部署完成后的 `Settings` > `Runtime variables and secrets` 中，若要对 D1 数据库中的敏感凭据（如 TOTP 密钥和恢复密钥）启用服务端信封加密，请添加一个名为 `KEK_v1`、类型为 `机密 (Secret)` 的变量，并输入您的安全密钥。在需要轮换 KEK 密钥时，请按顺序添加新的机密 `KEK_v(N+1)`（例如 `KEK_v2` -> `KEK_v3` 等）。

#### 2. 本地开发与命令行部署

##### 开发环境需求
- **Node.js**: v18.x 或更高版本（推荐 v22.5.0+）
- **Package Manager**: npm
- **Cloudflare Account**: 需要启用 Workers 和 D1 权限

##### 部署步骤
```bash
# 1. 克隆仓库并安装依赖
npm install

# 2. 初始化与迁移本地 D1 数据库
npm run db:setup
npm run db:migrate:dev

# 3. 配置本地环境变量 (.dev.vars)
echo "JWT_SECRET=您的随机安全JWT密钥" > .dev.vars
echo "KEK_v1=您的随机安全KEK密钥" >> .dev.vars

# 4. 启动本地开发服务
npm run dev

# 5. 手动部署上线至 Cloudflare
npm run deploy
```

---

### 线上部署到 Cloudflare Pages (⚠️ 不推荐)

如果您希望以 Cloudflare Pages (Advanced Mode) 部署该项目：

> [!WARNING]
> **不推荐使用 Pages 部署**：本项目主要是 DNS 解析服务，对请求响应延迟极其敏感。Workers 作为轻量边缘函数比 Pages Functions 更适合此类低延迟 DoH 解析任务，且管理数据库绑定和路由配置更为直接。建议优先选择上述 Worker 部署方式。

1.  **创建 D1 数据库**并复制其数据库 ID，将 ID 填入 `wrangler.toml` 中的 `database_id`。
2.  在 Cloudflare 控制台选择 `Workers & Pages` > `Create application` > `Pages` > `Connect to Git`。
3.  选择您的 Fork 仓库，并在构建设置中配置：
    *   **框架预设 (Framework preset)**: `None`
    *   **构建命令 (Build command)**: `npm run build:pages`
    *   **输出目录 (Build output directory)**: `static`
4.  部署完成后，前往 Pages 项目的 **设置 (Settings)** > **函数 (Functions)** > **D1 数据库绑定 (D1 database bindings)**，添加一个绑定：
    *   **变量名称 (Variable name)**: `DB`
    *   **D1 数据库**: 选择您刚刚创建的 `dns_worker_db` 数据库。
5.  重新部署该 Pages 项目以使绑定生效。

### ⚖️ 双引擎架构与部署特性对比

无论您是追求全球 300+ 城市的极速边缘调度与零运维，还是追求 100% 数据自主可控、家庭路由器直连经典 UDP 53 以及 Android 原生私有 DNS（DoT 853），DNS Worker 均能提供企业级过滤、本地优先瞬间分析以及基于后量子密码学的零知识端到端加密日志。

| 特性 / 维度 | 🖥️ 独立服务器 / VPS (脱离 Cloudflare) | ☁️ Cloudflare Workers 边缘模式 |
|---|---|---|
| **核心定位** | 100% 数据主权、家庭局域网/路由器直连、Android DoT | 全球极速边缘解析、免运维 Serverless |
| **运行平台** | Linux / VPS / macOS / Windows (`Node.js >= 22.5.0`) | Cloudflare 全球 300+ 城市边缘节点 |
| **存储介质** | 原生 Node.js SQLite (`node:sqlite`)，存储于本地 NVMe/SSD | Cloudflare D1（全球分布式云端数据库） |
| **支持协议** | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (RFC 8484) | **DoH** (RFC 8484 over HTTPS) |
| **数据主权** | **100% 自主可控**，完全无云厂商锁定 | 边缘加密；托管于 Cloudflare 基础设施 |
| **路由器 / 局域网接入** | **直接监听 UDP 53**（路由器 WAN/LAN DNS 直填服务器 IP） | 需搭配 DoH 客户端、代理或分流工具 |
| **Android 私有 DNS** | **原生 DoT 853**，支持 SNI 路由 (`<profile_key>.dns.example.com`) | 需通过 DoH URL 或第三方客户端支持 |
| **后量子零知识 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + 通行密钥 WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + 通行密钥 WebAuthn |
| **本地优先 Web UI** | ✅ 浏览器端 SQLite WASM + OPFS 0ms 瞬间查询 | ✅ 浏览器端 SQLite WASM + OPFS 0ms 瞬间查询 |
| **运维与维护** | 标准 systemd 常驻服务 (`npm run service-create:linux`) | 零服务器维护，边缘自适应伸缩 |
| **费用与门槛** | 运行于既有 VPS 或家用服务器硬件 | Cloudflare 免费套餐额度内免费运行 |

---

## 💪 动力

* [Cloudflare Workers](https://workers.cloudflare.com/) & [D1 Database](https://developers.cloudflare.com/d1/)
* [Node.js](https://nodejs.org/) (内置原生 `node:sqlite` 引擎)

## 🚚 依赖

* [React](https://github.com/facebook/react) & [Blueprint](https://github.com/palantir/blueprint) (现代化企业级高密度 UI)
* [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
* [NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) (ML-KEM-768 后量子混合格密码学)
* [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) (WebAssembly SQLite & OPFS 本地优先驱动)

---

## 📄 开源协议

本项目采用 [AGPLv3](LICENSE) 协议授权。

---

## 📝 总结

DNS Worker 让您在完全自主掌控 DNS 解析的同时，无需在隐私、性能与灵活性之间做任何妥协。通过同时支持高性能 Node.js 独立服务器与 Cloudflare Workers 全球边缘网络，它呈现了一个生产级的 Protective DNS 体系：

-   **双引擎自由选择**：既可完全脱离 Cloudflare 独立运行于自有 VPS，独享经典 UDP 53 与 DoT 853；亦可无服务器部署于 Cloudflare 边缘节点，享受零维护的全球 DoH 体验。
-   **全协议覆盖**：经典 UDP 53、Android 原生私有 DNS（DoT 853 配合 SNI 路由）及 DoH (RFC 8484)。
-   **后量子零知识 E2EE**：基于 NIST FIPS 203 **P256-MLKEM768** 与硬件通行密钥 (WebAuthn)，全面防御针对 DNS 隐私日志的未来量子解密威胁。
-   **本地优先极速分析**：借助浏览器端 SQLite WASM + OPFS 实现 0ms 瞬间查询与图表聚合，彻底告别频繁消耗云端数据库读配额。
-   **精细策略掌控**：多配置隔离、重写 ECH 抵御 SNI 审查，以及布隆过滤器加速的百万级广告与恶意域名拦截订阅。

无论是保护单台移动设备、整个家庭网络，还是跨地域的组织环境，DNS Worker 都提供了一个优雅且数据完全自主的替代方案。

<div align="center">
  <br>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
  <br><br>
  <b>如果 DNS Worker 对您有所帮助，请考虑给它一个 ⭐</b>
</div>
