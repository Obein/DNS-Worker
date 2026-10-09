---
title: Cloudflare Workers 边缘模式部署
description: 依托 Cloudflare 全球 300+ 边缘网络与 D1 数据库的 Serverless 部署指南。
---

Cloudflare Workers 模式让您无需维护任何底层服务器，零成本借助全球边缘节点运行高可用 DoH 解析器。

## 方案 1：通过 GitHub Fork 自动部署（推荐）

1. **Fork 仓库**：点击页面右上角 `Fork` 将项目克隆至您的 GitHub 账号。
2. **创建 D1 数据库**：
   - 登录 Cloudflare 控制台，进入 `Workers & Pages` > `D1`；
   - 点击 `Create database`，命名为 `dns_worker_db`，复制生成的 Database ID。
3. **配置 wrangler.toml**：
   - 在您的 Fork 仓库中打开 `wrangler.toml`；
   - 将 `database_id` 替换为刚才创建的实际 ID。
4. **导入并连接 Worker**：
   - 在 Cloudflare 控制台进入 `Workers & Pages` > `Create application` > 选择 `Continue with GitHub`；
   - 绑定仓库，配置构建设置：
     - 构建命令：`npm run build`
     - 部署命令：`npm run deploy`
     - 输出目录：`/`
5. **设置运行时 Secret**：
   - 首次部署完成后，进入 Worker 设置页 `Settings` > `Variables and secrets`；
   - 添加 `JWT_SECRET`（类型选择 `Secret`，输入高强度随机字符串）；
   - （可选）若需开启服务端凭据信封加密，添加 `KEK_v1`（类型选择 `Secret`）。

---

## 方案 2：CLI 本地开发与命令行部署

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
