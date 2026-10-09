---
title: 身份认证、密钥体系与信封加密
description: 零信任 WebApp 安全标准、Refresh Token Rotation (RTR)、版本化 KEK 信封加密机制与安全环境变量手册。
sidebar:
  order: 4
---

DNS Worker 在网络解析层与 Web 控制面板中全方位贯彻零信任防御理念。本文档深度剖析系统身份验证流程、密钥轮转机制及安全相关环境变量。

---

## 1. Web 控制台零信任认证架构

Web 控制台严格遵循 **WebApp Trust** 安全架构规范：

```
[ 浏览器客户端 ]                                         [ DNS Worker 服务端 ]
        │                                                        │
        │── 1. POST /api/auth/login (密码 + 一次性 Nonce) ──────▶│
        │                                                        │ (Argon2 / PBKDF2 哈希比对)
        │◀── 2. Access Token (内存) + Refresh Token (Cookie) ────│
        │                                                        │
        │── 3. 鉴权 RPC 调用 (Authorization: Bearer) ───────────▶│
        │                                                        │
        │── 4. POST /api/auth/refresh (RTR 并发容错窗口) ───────▶│
        │                                                        │ (签发新 Token 并作废旧 Token)
        │◀── 5. 轮换 Access Token + 轮换 Refresh Token ─────────│
```

### 核心安全特性
- **随机 Nonce 防重放**：对敏感管理操作引入密码学随机 Nonce，免疫重放攻击。
- **不可导出 Web Crypto 密钥**：浏览器端密钥运算（如 PQC ML-KEM、AES-GCM 日志加解密）在独立 Web Worker 中执行，密钥句柄标记为不可提取（non-extractable）。
- **刷新令牌单次轮换 (RTR)**：每个 Refresh Token 仅限兑换一次，兑换后立即废止。
- **并发宽限窗口 (Concurrency Grace Window)**：多标签页并发请求时，在 `RTR_GRACE_WINDOW_MS` 毫秒内允许完成平滑令牌过渡，防止意外登出。

---

## 2. 信封加密 (DEK / KEK) 与平滑轮换

对数据库中的敏感信息（如用户会话凭证及隐私查询日志），采用两层信封加密：

```
┌────────────────────────────────────────────────────────┐
│ 密钥加密密钥 (KEK_v1 / KEK_v2)                         │
│ (保存在安全环境变量或 Cloudflare Secrets 中)           │
└────────────────────────────────────────────────────────┘
                           │ (加解密)
                           ▼
┌────────────────────────────────────────────────────────┐
│ 数据加密密钥 (DEK)                                     │
│ (按日志批次或单条会话随机派生)                          │
└────────────────────────────────────────────────────────┘
                           │ (加解密)
                           ▼
               [ 敏感数据明文 / 日志 Payload ]
```

### 零停机版本化平滑轮转
1. 系统自动使用编号最高的有效密钥（例如 `KEK_v2`）作为当前加密密钥。
2. 历史遗留数据即使使用 `KEK_v1` 或旧版 `JWT_SECRET`（v0）加密，依然可平滑解密。
3. 伴随数据写回或后台维护任务，旧版数据将在运行中被透明重加密为最新版本。

---

## 3. 安全环境变量参考手册

请在 `.env`（独立服务器模式）中配置，或使用 `wrangler secret put <名称>` 录入 Cloudflare 凭据：

### `JWT_SECRET`
- **类型**：`string`（至少 32 字符）
- **职责**：系统旧版 Token 签名主密钥及 KEK_v0 回退密钥。
- **安全要求**：必须为高熵随机字符串，禁止使用弱密码。
- **生成命令**：
  ```bash
  openssl rand -base64 32
  ```

### `KEK_v1`, `KEK_v2`, ...
- **类型**：`string`（至少 32 字符）
- **职责**：版本化的信封加密密钥。
- **示例**：
  ```ini
  KEK_v1=c3VwZXJzZWNyZXRrZXl2MWV4YW1wbGUxMjM0NTY3ODk=
  KEK_v2=bmV3ZXJzZWNyZXRrZXl2MmV4YW1wbGUxMjM0NTY3ODk=
  ```
  服务自动识别最大序号（`v2`）为主加密密钥，旧序号用于向后解密兼容。

### `SERVERFULL_API_KEY`
- **类型**：`string`
- **职责**：外部自动化运维接口与 Cloudflare 远程调用的 Bearer 认证令牌。
- **请求头**：`Authorization: Bearer <SERVERFULL_API_KEY>`。

### `ADMIN_PASSWORD`
- **类型**：`string`
- **职责**：初次部署并初始化 Web 仪表盘时的超级管理员密码。
