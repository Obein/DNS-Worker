---
title: 快速上手
description: 在 60 秒内体验与部署您的专属 DNS Worker 实例。
---

DNS Worker 提供两种适配不同场景的部署路径。作为**以 Serverless 为核心优先**的项目，将服务部署至 Cloudflare Workers 是最推荐的零运维全球边缘防护方案。

---

## 方案 1：部署至 Cloudflare Workers（Serverless 边缘模式 / 首选推荐）

免去繁琐的服务器配置与运维，依托 Cloudflare 全球 300+ 节点实现高可用解析。

### 1. 克隆仓库并安装依赖
```bash
git clone https://github.com/Obein/DNS-Worker.git
cd DNS-Worker
npm install
```

### 2. 创建 Cloudflare D1 分布式数据库
```bash
# 登录 Cloudflare 账号
npx wrangler login

# 创建专属 D1 数据库
npm run db:setup
```
将控制台输出的 `database_id` 填入项目根目录 `wrangler.toml` 的 `[[d1_databases]]` 中：
```toml
[[d1_databases]]
binding = "DB"
database_name = "dns_worker_db"
database_id = "填写您的_database_id"
```

### 3. 初始化数据表结构并一键部署
```bash
# 1. 向云端 D1 数据库应用初始化数据表结构
npm run db:migrate:prod

# 2. 编译 Web 控制台并一键部署 Worker
npm run deploy
```

部署完成后，您的专属控制面板与 DoH 解析终端即刻上线：`https://<您的Worker名>.workers.dev`（或您绑定的自定义顶级域名）。

---

## 方案 2：独立服务器 / VPS 部署（Serverfull 自建可选方案）

若您需要内网路由器直接通过 UDP 53 解析，或直接使用 Android 原生私密 DNS（DoT 853 端口）：

```bash
# 1. 全局安装 CLI
npm install -g dns-worker

# 2. 初始化持久化数据目录与默认环境变量
dns-worker config init

# 3. 启动 DNS Worker 守护服务
dns-worker
```

启动后即可访问本地管理面板 `http://localhost:10080` 及经典 UDP DNS `127.0.0.1:53`。

---

## 下一步

- [浏览架构选型与双引擎对比](/DNS-Worker/zh-cn/deployment/matrix/)
- [深入了解 Cloudflare Workers 边缘模式](/DNS-Worker/zh-cn/deployment/cloudflare/)
- [创建接入点与配置各平台客户端](/DNS-Worker/zh-cn/networking/endpoints/)
- [独立服务器 TLS 证书申请与配置](/DNS-Worker/zh-cn/advanced/tls-certs/)
