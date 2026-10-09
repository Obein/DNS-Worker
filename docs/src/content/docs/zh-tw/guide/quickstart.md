---
title: 快速上手
description: 在 60 秒內體驗與部署您的專屬 DNS Worker 例項。
---

DNS Worker 提供兩種適配不同場景的部署路徑。作為**以 Serverless 為核心優先**的專案，將服務部署至 Cloudflare Workers 是最推薦的零運維全球邊緣防護方案。

---

## 方案 1：部署至 Cloudflare Workers（Serverless 邊緣模式 / 首選推薦）

免去繁瑣的伺服器配置與運維，依託 Cloudflare 全球 300+ 節點實現高可用解析。

### 1. 克隆倉庫並安裝依賴
```bash
git clone https://github.com/Obein/DNS-Worker.git
cd DNS-Worker
npm install
```

### 2. 建立 Cloudflare D1 分散式資料庫
```bash
# 登录 Cloudflare 账号
npx wrangler login

# 创建专属 D1 数据库
npm run db:setup
```
將控制台輸出的 `database_id` 填入專案根目錄 `wrangler.toml` 的 `[[d1_databases]]` 中：
```toml
[[d1_databases]]
binding = "DB"
database_name = "dns_worker_db"
database_id = "填写您的_database_id"
```

### 3. 初始化資料表結構並一鍵部署
```bash
# 1. 向云端 D1 数据库应用初始化数据表结构
npm run db:migrate:prod

# 2. 编译 Web 控制台并一键部署 Worker
npm run deploy
```

部署完成後，您的專屬控制面板與 DoH 解析終端即刻上線：`https://<您的Worker名>.workers.dev`（或您繫結的自定義頂級域名）。

---

## 方案 2：獨立伺服器 / VPS 部署（Serverfull 自建可選方案）

若您需要內網路由器直接通過 UDP 53 解析，或直接使用 Android 原生私密 DNS（DoT 853 埠）：

```bash
# 1. 全局安装 CLI
npm install -g dns-worker

# 2. 初始化持久化数据目录与默认环境变量
dns-worker config init

# 3. 启动 DNS Worker 守护服务
dns-worker
```

啟動後即可訪問本地管理面板 `http://localhost:10080` 及經典 UDP DNS `127.0.0.1:53`。

---

## 下一步

- [瀏覽架構選型與雙引擎對比](/DNS-Worker/zh-tw/deployment/matrix/)
- [深入瞭解 Cloudflare Workers 邊緣模式](/DNS-Worker/zh-tw/deployment/cloudflare/)
- [建立接入點與配置各平臺客戶端](/DNS-Worker/zh-tw/networking/endpoints/)
- [獨立伺服器 TLS 證書申請與配置](/DNS-Worker/zh-tw/advanced/tls-certs/)
