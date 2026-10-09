---
title: Cloudflare Workers 边缘模式部署
description: 依托 Cloudflare Workers 与 D1 数据库，在 300+ 边缘节点无服务器部署。
---

Cloudflare Workers 部署方式让您能够一键运行具备全球高可用特性的现代化 DoH 解析服务，彻底免除底层服务器的运维开销。

## 方案 1：Git 关联自动化部署 (推荐)

1. **Fork 仓库**：点击 GitHub 仓库右上角的 `Fork` 按钮，将其复制到您的个人账户。
2. **创建 D1 数据库**：
   - 进入 Cloudflare 控制台，导航至 `Workers & Pages` > `D1`；
   - 创建名为 `dns_worker_db` 的数据库，并复制生成的 Database ID。
3. **配置 wrangler.toml**：
   - 在您的 Fork 仓库中编辑 `wrangler.toml`；
   - 将 `database_id` 替换为真实的 D1 数据库 ID。
4. **部署应用**：
   - 前往 `Workers & Pages` > `Create application` > `Continue with GitHub`；
   - 关联您的仓库，并配置构建参数：
     - 构建命令：`npm run build`
     - 部署命令：`npm run deploy`
     - 输出目录：`/`
5. **配置凭据密钥**：
   - 部署完成后，进入项目 `Settings` > `Variables and secrets`；
   - 添加 `JWT_SECRET`（类型选择 `Secret`，填入高强度随机字符串）；
   - *(可选)* 添加 `KEK_v1`（类型选择 `Secret`），用于启用信封加密主密钥。

---

## 方案 2：本地 CLI 开发与部署

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

## Cloudflare D1 数据库 Studio 查验

部署完成后，所有用户、接入点、过滤规则及查询日志均持久化于 Cloudflare D1 分布式数据库中。您可以在 Cloudflare 控制台的 D1 Studio 中直接检索表数据与架构：

![Cloudflare D1 数据库 Studio 与数据检索](/DNS-Worker/screenshots/d1-studio-logs.png)
