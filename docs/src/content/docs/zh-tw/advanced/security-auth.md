---
title: 身份認證、金鑰體系與信封加密
description: 零信任 WebApp 安全標準、Refresh Token Rotation (RTR)、版本化 KEK 信封加密機制與安全環境變數手冊。
sidebar:
  order: 4
---

DNS Worker 在網路解析層與 Web 控制面板中全方位貫徹零信任防禦理念。本文件深度剖析系統身份驗證流程、金鑰輪轉機制及安全相關環境變數。

---

## 1. Web 控制台零信任認證架構

Web 控制台嚴格遵循 **WebApp Trust** 安全架構規範：

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
- **隨機 Nonce 防重放**：對敏感管理操作引入密碼學隨機 Nonce，免疫重放攻擊。
- **不可匯出 Web Crypto 金鑰**：瀏覽器端金鑰運算（如 PQC ML-KEM、AES-GCM 日誌加解密）在獨立 Web Worker 中執行，金鑰控制代碼標記為不可提取（non-extractable）。
- **重新整理令牌單次輪換 (RTR)**：每個 Refresh Token 僅限兌換一次，兌換後立即廢止。
- **併發寬限視窗 (Concurrency Grace Window)**：多標籤頁併發請求時，在 `RTR_GRACE_WINDOW_MS` 毫秒內允許完成平滑令牌過渡，防止意外登出。

---

## 2. 信封加密 (DEK / KEK) 與平滑輪換

對資料庫中的敏感資訊（如使用者會話憑證及隱私查詢日誌），採用兩層信封加密：

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

### 零停機版本化平滑輪轉
1. 系統自動使用編號最高的有效金鑰（例如 `KEK_v2`）作為當前加密金鑰。
2. 歷史遺留資料即使使用 `KEK_v1` 或舊版 `JWT_SECRET`（v0）加密，依然可平滑解密。
3. 伴隨資料寫回或後臺維護任務，舊版資料將在執行中被透明重加密為最新版本。

---

## 3. 安全環境變數參考手冊

請在 `.env`（獨立伺服器模式）中配置，或使用 `wrangler secret put <名称>` 錄入 Cloudflare 憑據：

### `JWT_SECRET`
- **型別**：`string`（至少 32 字元）
- **職責**：系統舊版 Token 簽名主金鑰及 KEK_v0 回退金鑰。
- **安全要求**：必須為高熵隨機字串，禁止使用弱密碼。
- **生成命令**：
  ```bash
  openssl rand -base64 32
  ```

### `KEK_v1`, `KEK_v2`, ...
- **型別**：`string`（至少 32 字元）
- **職責**：版本化的信封加密金鑰。
- **示例**：
  ```ini
  KEK_v1=c3VwZXJzZWNyZXRrZXl2MWV4YW1wbGUxMjM0NTY3ODk=
  KEK_v2=bmV3ZXJzZWNyZXRrZXl2MmV4YW1wbGUxMjM0NTY3ODk=
  ```
  服務自動識別最大序號（`v2`）為主加密金鑰，舊序號用於向後解密相容。

### `SERVERFULL_API_KEY`
- **型別**：`string`
- **職責**：外部自動化運維介面與 Cloudflare 遠端呼叫的 Bearer 認證令牌。
- **請求頭**：`Authorization: Bearer <SERVERFULL_API_KEY>`。

### `ADMIN_PASSWORD`
- **型別**：`string`
- **職責**：初次部署並初始化 Web 儀表盤時的超級管理員密碼。
