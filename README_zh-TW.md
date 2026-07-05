<div align="center">
  <img src="web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>基於 Cloudflare Workers & D1 的 Protective DNS 解析服務</p>
  <p>保護您的網際網路第一跳</p>
  <p align="center">
    <a href="README.md">English</a> | <a href="README_zh-CN.md">简体中文</a> | 正體中文
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)

</div>

---

## 📖 簡介

**DNS Worker** 是一個輕量級、可擴展的隱私保護 DNS 解析系統。它完全運行在 Cloudflare 的邊緣網路上，利用 Workers 的極速回應和 D1 資料庫的高效存儲，為使用者提供精細化 DNS (over HTTPS) 控制體驗。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

### 何以 DNS Worker？

| | 傳統 DNS 方案 | DNS Worker |
|---|---|---|
| **託管** | 需要 VPS 或家用伺服器 | 運行於 Cloudflare 免費層級，免伺服器 |
| **延遲** | 取決於伺服器位置 | 在全球 300+ 城市邊緣運算 |
| **維護** | 手動更新、系統修補 | 免維護的 Serverless 部署 |
| **擴展** | 受硬體限制 | 隨 Cloudflare 網路自動擴展 |
| **成本** | 伺服器費用 + 電費 | 個人使用基本免費 |

> 5 分鐘內部署您自己的隱私保護 DNS 解析器 —— 免信用卡、免伺服器、免維運。

### 什麼是 DNS over HTTPS (DoH)？

DoH (RFC 8484) 是一種透過加密的 HTTPS 連線進行 DNS 查詢的協定。與傳統明文 DNS 相比，DoH 能夠：

- **防止劫持**：防止 ISP 或第三方篡改 DNS 回應。
- **增強隱私**：透過加密隧道隱藏您的瀏覽紀錄。
- **繞過審查**：在受限網路環境下提供更穩定的解析服務。

---

## ✨ 核心功能

- 🚀 **極速解析**：完全基於邊緣運算，全球延遲極低。
- 🗒️ **多配置管理 (Profiles)**：支援建立多個獨立配置，每個配置擁有唯一的端點。
- 🛡️ **精細過濾**：
  - **黑/白名單**：支援精確網域及子網域萬用字元。
  - **第三方規則集**：支援訂閱 AdGuard 等格式的外部攔截清單。
  - **自訂重新導向**：支援 A/AAAA/TXT/CNAME 紀錄的自訂覆蓋。
- 📊 **即時統計與日誌**：視覺化儀表板，紀錄每一次請求的命中原因、地理位置及上游延遲。
- 🔐 **隱私增強**：支援 ECS (EDNS Client Subnet) 靈活配置（透傳、自訂或隱藏）。
- 🌗 **現代 UI**：支援暗黑模式，基於 React + BlueprintJS 建構的高密度管理面板。

---

## 🖼️ 介面預覽

| 使用者登入 |
|:---:|
| ![登入](docs/screenshots/dns.obex-login.webp) |

| 安裝引導 | 端點配置 |
|:---:|:---:|
| ![設置引導](docs/screenshots/dns.obex-setup.webp) | ![端點配置](docs/screenshots/dns.obex-endpoints.webp) |

| 分析統計 | 解析目的地 |
|:---:|:---:|
| ![統計分析](docs/screenshots/dns.obex-stats.webp) | ![解析目的地](docs/screenshots/dns.obex-stats_dest.webp) |

| 本地規則管理 | 外部攔截清單 |
|:---:|:---:|
| ![規則設置](docs/screenshots/dns.obex-rules.webp) | ![過濾清單](docs/screenshots/dns.obex-filter.webp) |

| 解析日誌 | 日誌詳情 |
|:---:|:---:|
| ![解析日誌](docs/screenshots/dns.obex-log.webp) | ![日誌詳情](docs/screenshots/dns.obex-log_detail.webp) |

| 配置選項 | 配置選擇 |
|:---:|:---:|
| ![高級設置](docs/screenshots/dns.obex-settings.webp) | ![配置選擇](docs/screenshots/dns.obex-profile_select.webp) |

| 行動端日誌 | 行動端統計 |
|:---:|:---:|
| ![行動端日誌](docs/screenshots/dns.obex-mobile_log.webp) | ![行動端統計](docs/screenshots/dns.obex-mobile_stats.webp) |

---

## 🛠️ 技術架構

### 程式碼結構

```text
├── src/
│   ├── index.ts          # 入口檔案，處理 HTTP 路由與中介軟體
│   ├── types.ts          # 型別定義
│   ├── api/              # API 控制器 (Auth, Account, Profiles)
│   ├── lib/              # 核心邏輯 (RBAC, 規則過濾)
│   ├── models/           # D1 資料庫模型
│   ├── pipeline/         # DNS 解析管線 (核心業務邏輯)
│   └── utils/            # 工具類 (快取, GeoIP, DNS 編解碼, Bloom 過濾器)
├── web/                  # React/BlueprintJS UI 前端專案
│   ├── public/           # 公共靜態檔案
│   ├── src/              # 前端原始碼
│   │   ├── assets/       # 靜態資源 (圖片、圖示等)
│   │   ├── components/   # 可複用的 UI 元件
│   │   ├── i18n/         # 國際化多語言配置
│   │   ├── layouts/      # 版面配置組件 (儀表板版面配置等)
│   │   ├── routes/       # 前端路由配置
│   │   ├── services/     # 統一 API 服務封裝 (鑑權、帳戶、設定檔等)
│   │   ├── views/        # 頁面 / 檢視 (儀表板、日誌、設定、引導等)
│   │   └── utils/        # 工具類及輔助函式
│   └── package.json      # 前端依賴配置
├── static/               # 編譯後的靜態資源
├── migrations/           # D1 資料庫遷移腳本
└── wrangler.toml         # Cloudflare 部署配置
```

### 解析管線 (Resolution Pipeline)

當一個 DNS 請求到達時，它會經過以下處理階段：

1.  **記憶體快取檢查**：檢查邊緣節點記憶體中是否存在該查詢的有效回應。
2.  **配置載入**：從記憶體 -> Cache API -> D1 資料庫分層載入 Profile 設定。
3.  **本地規則比對**：
    - **白名單**：命中則直接轉發上游並傳回。
    - **重新導向**：命中則傳回自訂紀錄。
    - **黑名單**：命中則傳回 NXDOMAIN、0.0.0.0 或自訂結果。
4.  **外部清單過濾**：
    - 利用 **Bloom Filter** (布隆過濾器) 進行快速篩選。
5.  **上游解析**：若以上均未命中，則根據配置請求上游 DoH 伺服器，並支援 ECS 處理。
6.  **非同步日誌與快取**：非同步紀錄解析日誌、獲取目標 GeoIP，並將結果寫入各級快取。

---

## 🚀 部署指南

### 開發環境參考

- **Node.js**: v18.x 或更高版本
- **Package Manager**: npm
- **Cloudflare Account**: 需要開啟 Workers 和 D1 權限

### 本地開發

1.  複製倉庫並安裝依賴：

```bash
npm install
```

2.  初始化 D1 資料庫：

```bash
npm run db:setup
npm run db:migrate:dev
```

3.  配置本地環境變數：
    *   在專案根目錄下建立一個 `.dev.vars` 檔案，並新增用於會話 Token 簽名的 JWT 金鑰：
        ```env
        JWT_SECRET=您的隨機安全JWT金鑰
        ```
    *   （選填）透過新增金鑰加密金鑰（KEK）啟用敏感資料（如 TOTP 金鑰和復原金鑰）的伺服器端信封加密：
        ```env
        KEK_v1=您的隨機安全KEK_v1金鑰
        ```

4.  啟動開發伺服器：

```bash
npm run dev
```

5.  部署上線

```bash
npm run deploy
```

### 線上部署 (Cloudflare Dashboard)

1.  **Fork 本專案**：點擊頁面右上角的 `Fork` 按鈕，將倉庫複製到你的 GitHub 帳號下。
2.  **建立 D1 資料庫**：登入 Cloudflare 控制台，前往 `Workers & Pages` > `D1`，建立一個新的資料庫（例如命名为 `obex_db`），並複製所建立的資料庫 ID。
3.  **配置資料庫 ID**：在你的 Fork 倉庫中，修改 `wrangler.toml` 檔案，將 `database_id` 替換為你剛才建立的資料庫 ID。
4.  **建立 Worker**：前往 Cloudflare 控制台 `Workers & Pages` > `Create application` > `Create Worker`。
5.  **從 GitHub 匯入**：在部署頁面選擇 `Deploy from GitHub`，關聯你 Fork 的專案並完成授權部署。
6.  **配置 JWT 金鑰**：登入 Cloudflare 控制台，前往 `Workers & Pages` > 點擊您的 Worker > `設定` > `變數` > 在 `環境變數` 下點擊 `新增變數`。將名稱設定為 `JWT_SECRET`，類型選擇 `機密 (Secret)`，值中輸入一個隨機安全字串，然後點擊 `儲存並部署`。
7.  **配置 KEK 啟用信封加密（選填）**：若要對 D1 資料庫中的敏感憑證（如 TOTP 金鑰和復原金鑰）啟用伺服器端信封加密，請新增一個名為 `KEK_v1`、類型為 `機密 (Secret)` 的變數，並輸入您的安全金鑰。在需要輪換 KEK 金鑰時，請按順序新增新的機密 `KEK_v(N+1)`（例如 `KEK_v2` -> `KEK_v3` 等）。

### 線上部署到 Cloudflare Pages (⚠️ 不推薦)

如果您希望以 Cloudflare Pages (Advanced Mode) 部署該專案：

> [!WARNING]
> **不推薦使用 Pages 部署**：本專案主要是 DNS 解析服務，對請求回應延遲極其敏感。Workers 作為輕量邊緣函數比 Pages Functions 更適合此類低延遲 DoH 解析任務，且管理資料庫綁定和路由配置更為直接。建議優先選擇上述 Worker 部署方式。

1.  **建立 D1 資料庫**並複製其資料庫 ID，將 ID 填入 `wrangler.toml` 中的 `database_id`。
2.  在 Cloudflare 控制台選擇 `Workers & Pages` > `Create application` > `Pages` > `Connect to Git`。
3.  選擇您的 Fork 倉庫，並在建構設定中配置：
    *   **框架預設 (Framework preset)**: `None`
    *   **建構命令 (Build command)**: `npm run build:pages`
    *   **輸出目錄 (Build output directory)**: `static`
4.  建構完成後，前往 Pages 專案的 **設定 (Settings)** > **函數 (Functions)** > **D1 資料庫綁定 (D1 database bindings)**，新增一個綁定：
    *   **變數名稱 (Variable name)**: `DB`
    *   **D1 資料庫**: 選擇您剛剛建立的 `obex_db` 資料庫。
5.  重新部署該 Pages 專案以使綁定生效。

---

## 💪 感謝

* [Cloudflare Workers](https://workers.cloudflare.com/)
* [Blueprint](https://github.com/palantir/blueprint) (at Palantir)
* [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
* [React](https://github.com/facebook/react)

---

## 📄 開源協定

本專案採用 [AGPLv3](LICENSE) 協定授權。

---

## 📝 總結

DNS Worker 讓您完全掌控自己的 DNS 解析 —— 免租用伺服器、免管理基礎設施、隱私零妥協。假助 Cloudflare Workers 的全球邊緣網路和 D1 資料庫，可提供一個生產級 Protective DNS 服務：

-   **免費運行** —— 基於 Cloudflare 慷慨的免費方案
-   **全球極速** —— 得益於遍佈 300+ 個城市的邊緣節點
-   **高度可自訂** —— 支援多配置規則、黑白名單及第三方過濾清單訂閱
-   **隱私優先** —— 加密 DoH 傳輸，靈活的 ECS 控制
-   **部署簡單** —— 一鍵部署或簡單的 `npm run deploy` 即可上線

無論是保護單台裝置還是為家庭管理 DNS，DNS Worker 都提供了一個優雅的自託管替代方案 —— 免去商業 DNS 過濾服務的成本與複雜性。

<div align="center">
  <br>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
  <br><br>
  <b>如果 DNS Worker 對您有幫助，請考慮給它一個 ⭐</b>
</div>
