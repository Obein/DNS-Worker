---
title: Cloudflare Workers 邊緣模式部署
description: 依託 Cloudflare 全球 300+ 邊緣網路與 D1 資料庫的 Serverless 部署指南。
---

Cloudflare Workers 模式讓您無需維護任何底層伺服器，零成本藉助全球邊緣節點執行高可用 DoH 解析器。

## 方案 1：通過 GitHub Fork 自動部署（推薦）

1. **Fork 倉庫**：點選頁面右上角 `Fork` 將專案克隆至您的 GitHub 賬號。
2. **建立 D1 資料庫**：
   - 登入 Cloudflare 控制台，進入 `Workers & Pages` > `D1`；
   - 點選 `Create database`，命名為 `dns_worker_db`，複製生成的 Database ID。
3. **配置 wrangler.toml**：
   - 在您的 Fork 倉庫中開啟 `wrangler.toml`；
   - 將 `database_id` 替換為剛才建立的實際 ID。
4. **匯入並連線 Worker**：
   - 在 Cloudflare 控制台進入 `Workers & Pages` > `Create application` > 選擇 `Continue with GitHub`；
   - 繫結倉庫，配置構建設定：
     - 構建命令：`npm run build`
     - 部署命令：`npm run deploy`
     - 輸出目錄：`/`
5. **設定執行時 Secret**：
   - 首次部署完成後，進入 Worker 設定頁 `Settings` > `Variables and secrets`；
   - 新增 `JWT_SECRET`（型別選擇 `Secret`，輸入高強度隨機字串）；
   - （可選）若需開啟服務端憑據信封加密，新增 `KEK_v1`（型別選擇 `Secret`）。

---

## 方案 2：CLI 本地開發與命令列部署

```bash
# 1. 克隆并安装依赖
npm install

# 2. 初始化本地 D1 数据库与执行迁移
npm run db:setup
npm run db:migrate:dev

# 3. 配置本地开发密钥 (.dev.vars)
echo "JWT_SECRET=your_secure_random_jwt_secret" > .dev.vars
echo "KEK_v1=your_secure_kek_v1_secret" >> .dev.vars

# 4. 启动本地 Wrangler 开发服务
npm run dev

# 5. 部署到 Cloudflare 生产环境
npm run deploy
```
