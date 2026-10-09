---
title: Cloudflare Workers 邊緣模式部署
description: 依託 Cloudflare Workers 與 D1 資料庫，在 300+ 邊緣節點無伺服器部署。
---

Cloudflare Workers 部署方式讓您能夠一鍵執行具備全球高可用特性的現代化 DoH 解析服務，徹底免除底層伺服器的運維開銷。

## 方案 1：Git 關聯自動化部署 (推薦)

1. **Fork 倉庫**：點選 GitHub 倉庫右上角的 `Fork` 按鈕，將其複製到您的個人賬戶。
2. **建立 D1 資料庫**：
   - 進入 Cloudflare 控制台，導航至 `Workers & Pages` > `D1`；
   - 建立名為 `dns_worker_db` 的資料庫，並複製生成的 Database ID。
3. **配置 wrangler.toml**：
   - 在您的 Fork 倉庫中編輯 `wrangler.toml`；
   - 將 `database_id` 替換為真實的 D1 資料庫 ID。
4. **部署應用**：
   - 前往 `Workers & Pages` > `Create application` > `Continue with GitHub`；
   - 關聯您的倉庫，並配置構建引數：
     - 構建命令：`npm run build`
     - 部署命令：`npm run deploy`
     - 輸出目錄：`/`
5. **配置憑據金鑰**：
   - 部署完成後，進入專案 `Settings` > `Variables and secrets`；
   - 新增 `JWT_SECRET`（型別選擇 `Secret`，填入高強度隨機字串）；
   - *(可選)* 新增 `KEK_v1`（型別選擇 `Secret`），用於啟用信封加密主金鑰。

---

## 方案 2：本地 CLI 開發與部署

```bash
# 1. 克隆代码仓库并安装依赖
npm install

# 2. 初始化并迁移本地 D1 数据库
npm run db:setup
npm run db:migrate:dev

# 3. 配置本地开发密钥 (.dev.vars)
echo "JWT_SECRET=your_secure_random_jwt_secret" > .dev.vars
echo "KEK_v1=your_secure_kek_v1_secret" >> .dev.vars

# 4. 启动本地开发服务
npm run dev

# 5. 部署到 Cloudflare Workers
npm run deploy
```

---

## Cloudflare D1 資料庫 Studio 查驗

部署完成後，所有使用者、接入點、過濾規則及查詢日誌均持久化於 Cloudflare D1 分散式資料庫中。您可以在 Cloudflare 控制台的 D1 Studio 中直接檢索表資料與架構：

![Cloudflare D1 資料庫 Studio 與資料檢索](/DNS-Worker/screenshots/d1-studio-logs.png)
