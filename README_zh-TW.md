<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="ObexDNS Logo" width="128">
  <h1>ObexDNS</h1>
  <p>隱私優先的高效能 Protective DNS 解析器 & DoH / DoT 伺服端</p>
  <p>保護您的網際網路第一跳 · 雙引擎架構：Cloudflare Workers 邊緣無伺服器或獨立伺服器 / VPS (Linux / macOS / Windows)</p>
  <p align="center">
    <a href="README.md">English</a> | <a href="README_zh-CN.md">中文 (简体)</a> | 中文 (正體)
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js >= 22.5](https://img.shields.io/badge/Runtime-Node.js%20%3E%3D%2022.5-green.svg)](https://nodejs.org/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Protocols: UDP 53 · DoT 853 · DoH](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20853%20%7C%20DoH-brightgreen.svg)](#-雙引擎架構與部署特性對比)

</div>

---

## 📖 簡介

**ObexDNS**（前身為 DNS Worker）是一個專為隱私與效能打造的高效能 Protective DNS 解析系統，採用**雙引擎架構（Dual-Engine Architecture）**。它既可以作為免維運的 Serverless 邊緣應用完全運行在 Cloudflare Workers 網路上，也可以**完全脫離 Cloudflare**，在您的自有 VPS、家用伺服器或實體機（Linux、macOS、Windows）上以獨立服務模式運行，並採用原生 Node.js 內建 SQLite 儲存。

無論您是追求全球 300+ 城市的極速邊緣調度與零維運，還是追求 100% 資料自主可控、家庭路由器直連經典 UDP 53 以及 Android 原生私人 DNS（DoT 853），ObexDNS 均能提供企業級過濾、本機優先瞬間分析以及基於後量子密碼學的零知識端到端加密日誌。

### ⚖️ 雙引擎架構與部署特性對比

| 特性 / 維度 | 🖥️ 獨立伺服器 / VPS (脫離 Cloudflare) | ☁️ Cloudflare Workers 邊緣模式 |
|---|---|---|
| **核心定位** | 100% 資料主權、家庭區域網路/路由器直連、Android DoT | 全球極速邊緣解析、免維運 Serverless |
| **運行平台** | Linux / VPS / macOS / Windows (`Node.js >= 22.5.0`) | Cloudflare 全球 300+ 城市邊緣節點 |
| **儲存媒介** | 原生 Node.js SQLite (`node:sqlite`)，儲存於本機 NVMe/SSD | Cloudflare D1（全球分散式雲端資料庫） |
| **支援協定** | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (RFC 8484) | **DoH** (RFC 8484 over HTTPS) |
| **資料主權** | **100% 自主可控**，完全無雲廠商鎖定 | 邊緣加密；託管於 Cloudflare 基礎設施 |
| **路由器 / 區域網路接入** | **直接監聽 UDP 53**（路由器 WAN/LAN DNS 直填伺服器 IP） | 需搭配 DoH 用戶端、代理或分流工具 |
| **Android 私人 DNS** | **原生 DoT 853**，支援 SNI 路由 (`<profile_key>.dns.example.com`) | 需透過 DoH URL 或第三方用戶端支援 |
| **後量子零知識 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + 通行密鑰 WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + 通行密鑰 WebAuthn |
| **本機優先 Web UI** | ✅ 瀏覽器端 SQLite WASM + OPFS 0ms 瞬間查詢 | ✅ 瀏覽器端 SQLite WASM + OPFS 0ms 瞬間查詢 |
| **維運與維護** | 標準 systemd 常駐服務 (`npm run service-create:linux`) | 零伺服器維護，邊緣自適應擴展 |
| **費用與門檻** | 運行於既有 VPS 或家用伺服器硬體 | Cloudflare 免費方案配額內免費運行 |

### 什麼是 DNS over HTTPS (DoH) 與 DNS over TLS (DoT)？

* **DNS over HTTPS (DoH / RFC 8484)**：透過加密的 HTTP/2 或 HTTP/3 連線進行 DNS 查詢。ObexDNS 提供標準 DoH 端點，相容各大現代瀏覽器、作業系統及 stub 用戶端。
* **DNS over TLS (DoT / RFC 7858)**：在標準 853 連接埠上透過 TLS 隧道直接加密 DNS 查詢。ObexDNS 獨立模式原生支援 TLS SNI 設定路由，完美契合 Android 9+ 系統自帶的「私人 DNS」（Private DNS）。
* **經典 UDP DNS (RFC 1035)**：標準明文 53 連接埠 DNS。ObexDNS 獨立模式支援直接在區域網路內提供奈秒/微秒級低延遲解析，無縫接管家用路由器與各類傳統網路設備。

---

## ✨ 核心功能

- 🌐 **雙引擎自由部署**：支援 Cloudflare Workers 邊緣 Serverless 運行，亦可完全脫離 Cloudflare 在自有 VPS/伺服器上獨立部署。
- ⚡ **全協定覆蓋**：
  - **經典 UDP 53**：標準 RFC 1035 UDP DNS，路由器與內網設備隨插即用。
  - **DoT 853 (DNS over TLS)**：標準 RFC 7858 加密 DNS，支援 SNI Profile 路由（如 `<profile_key>.dns.example.com`），完美契合 Android 原生私人 DNS。
  - **DoH (DNS over HTTPS)**：標準 RFC 8484 加密 DNS，支援 HTTP/2 與 HTTP/3。
- 🚀 **極速解析**：記憶體與邊緣分層加速，奈秒/微秒級回應。
- 🗒️ **多配置管理 (Profiles)**：支援建立多個獨立配置，每個配置擁有唯一的端點與規則集合。
- 🛡️ **精細過濾**：
  - **黑/白名單**：支援精確網域及子網域萬用字元。
  - **第三方規則集**：支援訂閱 AdGuard、EasyList、hosts 等格式的外部攔截清單，藉助布隆過濾器毫秒級命中。
  - **自訂重新導向**：支援 A/AAAA/TXT/CNAME 紀錄的自訂覆蓋。
- 📊 **即時統計與日誌**：視覺化儀表板，紀錄每一次請求的命中原因、地理位置及上游延遲。
- 🔐 **隱私增強**：支援 ECS (EDNS Client Subnet) 靈活配置（透传、自訂或隱藏）。
- 🔒 **重寫 ECH & ECH Fronting**：針對 HTTPS (Type 65) / SVCB (Type 64) 查詢，自動重寫/注入 ECH (Encrypted Client Hello) 參數與自訂表層偽裝網域名稱（Outer SNI / ECH Fronting），全程加密真實目標網域名稱以防中間人窺探與阻斷。（*註：重寫注入功能僅支援由 Cloudflare 代理的網域名稱*）。
- ⚡ **本機優先架構 (Local-First)**：基於瀏覽器原生 OPFS (Origin Private File System) 與 WebAssembly SQLite 建構。解析日誌與統計圖表本機 0ms 瞬間渲染，背景雙向增量同步，大幅節省資料庫讀取配額且支援離線分析。
- 🛡️ **後量子零知識端到端加密 (E2EE)**：支援由硬體通行密鑰 (Passkey / WebAuthn) 及修復金鑰保護的端到端日誌信封加密。基於 NIST FIPS 203 **P256-MLKEM768** 後量子混合格密碼學與週期性小時級 KEM DEK，持久化儲存僅留不可逆密文，唯有已授權裝置可在本機解密還原。
- 🌗 **現代 UI**：支援暗黑模式，基於 React + BlueprintJS 建構的高密度管理面板。

---

## 🔐 深度隱私安全：本機優先與後量子 E2EE

DNS Worker 將本機優先（Local-First）運算與前沿抗量子密碼學結合，徹底重塑個人 DNS 日誌的安全與隱私邊界：

### ⚡ 本機優先瀏覽器 SQLite (OPFS + WASM)
* **0ms 極速檢索與分析**：採用瀏覽器私有檔案系統（OPFS）與 Web Worker 背景驅動的 WebAssembly SQLite 資料庫。日誌搜尋、多維過濾與統計圖表渲染均在客戶端本機毫秒級完成。
* **節省 D1 配額與離線可用**：日常日誌翻頁與統計聚合無需頻繁消耗 Cloudflare D1 每日讀取配額；即使網路中斷或服務離線，本機歷史資料依然可以隨時秒級查詢。
* **增量平滑同步**：背景自適應雙向資料同步機制，確保本機資料與雲端最新紀錄無縫對齊，UI 執行緒全程絲滑順暢。

### 🛡️ 後量子端到端加密 (P256-MLKEM768 / NIST FIPS 203)
* **雲端持久化零知識**：敏感 DNS 欄位（請求網域名稱、客戶端 IP、解析紀錄、GeoIP 及上游資訊）在寫入雲端資料庫前均已加密。Cloudflare Workers 執行階段及 D1 資料庫僅留存密文。
* **抗量子混合格密碼學**：採用國際標準化組織 NIST FIPS 203 **P256-MLKEM768**（ML-KEM-768 + ECDH P-256）混合演算法，防禦量子運算時代的「先竊取後解密（Harvest Now, Decrypt Later）」攻擊。
* **解耦式小時級信封加密**：創新性採用週期性 KEM 衍生資料加密金鑰（DEK），規避後量子密文的資料庫膨脹，節省約 80% 密文儲存體積，同時實現 **20,000+ 次/秒** 的超高速管線加密輸送量。
* **硬體通行密鑰綁定**：私密金鑰種子僅透過硬體通行密鑰（Passkey / WebAuthn PRF）或一次性自輪換修復金鑰（Recovery Key）在本機加解密，私密金鑰明文絕不上傳或離開裝置。

---

## 🖼️ 介面預覽

| 使用者登入 |
|:---:|
| ![登入](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-login.webp) |

| 安裝引導 | 端點配置 |
|:---:|:---:|
| ![設置引導](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-setup.webp) | ![端點配置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-endpoints.webp) |

| 分析統計 | 解析目的地 |
|:---:|:---:|
| ![統計分析](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![解析目的地](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) |

| 本地規則管理 | 外部攔截清單 |
|:---:|:---:|
| ![規則設置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) | ![過濾清單](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) |

| 解析日誌 | 日誌詳情 |
|:---:|:---:|
| ![解析日誌](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) | ![日誌詳情](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log_detail.webp) |

| 配置選項 | 配置選擇 |
|:---:|:---:|
| ![高級設置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-settings.webp) | ![配置選擇](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-profile_select.webp) |

| 行動端日誌 | 行動端統計 |
|:---:|:---:|
| ![行動端日誌](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_log.webp) | ![行動端統計](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) |

---

## 🛠️ 技術架構

### 程式碼結構

```text
├── src/
│   ├── index.ts          # Cloudflare Worker 入口，處理 HTTP 路由與 DoH
│   ├── serverfull/       # 獨立伺服器模式入口 (UDP 53, DoT 853, HTTP 3000)
│   │   ├── index.ts      # Serverfull CLI 與主啟動引導
│   │   ├── udp.ts        # 經典 RFC 1035 UDP 53 DNS 伺服端
│   │   ├── dot.ts        # RFC 7858 DoT 853 伺服端 (支援 TLS SNI Profile 路由)
│   │   ├── http.ts       # Web 控制台與 DoH HTTP 伺服端
│   │   └── db.ts         # 原生 Node.js SQLite (node:sqlite) 配接器與自動遷移
│   ├── types.ts          # 型別定義
│   ├── api/              # API 控制器 (Auth, Account, Profiles)
│   ├── lib/              # 核心邏輯 (RBAC, 規則過濾, PQC 密碼學, DEK 管理器)
│   ├── models/           # 資料庫模型 (統一適配 D1 與 SQLite)
│   ├── pipeline/         # DNS 解析管線 (統一核心業務邏輯)
│   └── utils/            # 工具類 (快取, GeoIP, DNS 編解碼, Bloom 過濾器)
├── web/                  # React/BlueprintJS UI 前端專案 (本機優先 WASM + OPFS)
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
├── scripts/              # 輔助自動化腳本 (如 Linux systemd 服務產生器)
├── migrations/           # 統一 SQL 資料庫遷移腳本
└── wrangler.toml         # Cloudflare 部署配置
```

### 解析管線 (Resolution Pipeline)

當一個 DNS 請求到達時，它會經過以下處理階段：

1.  **記憶體快取檢查**：檢查邊緣或行程記憶體中是否存在該查詢的有效回應。
2.  **配置載入**：從記憶體 -> Cache API -> 資料庫 (D1 或本機 SQLite) 分層載入 Profile 設定。
3.  **本地規則比對**：
    - **白名單**：命中則直接轉發上游並傳回。
    - **重新導向**：命中則傳回自訂紀錄。
    - **黑名單**：命中則傳回 NXDOMAIN、0.0.0.0 或自訂結果。
4.  **外部清單過濾**：
    - 利用 **Bloom Filter** (布隆過濾器) 進行快速篩選。
5.  **上游解析**：若以上均未命中，則根據配置請求上游 DoH 伺服器，並支援 ECS 處理。
6.  **非同步日誌與快取**：非同步紀錄解析日誌（支援 PQC 零知識端到端加密）、獲取目標 GeoIP，並將結果寫入各級快取。

---

## 🚀 部署指南

ObexDNS 提供兩種部署型態，滿足不同情境的使用需求：
* **方案 A：🖥️ 獨立伺服器 / VPS 部署 (脫離 Cloudflare, 100% 資料自主)** —— 推薦給追求完全自主可控、家庭路由器直連 UDP 53 及 Android 原生 DoT 853 的自建玩家與企業。
* **方案 B：☁️ Cloudflare Workers 邊緣模式 (無伺服器, 免維運)** —— 推薦給追求全球 300+ 節點低延遲、零伺服器硬體維護成本的個人與團隊。

---

### 方案 A：🖥️ 獨立伺服器 / VPS 部署 (脫離 Cloudflare, 100% 資料自主)

ObexDNS 可完全脫離 Cloudflare Workers，直接在 Linux、Windows、macOS 伺服器或虛擬機上以獨立服務模式運行，依賴 Node.js `>= 22.5.0` 內建的 `node:sqlite` 引擎。無需任何 Cloudflare 帳號、API Token 或外部資料庫。

#### 獨立模式核心特性
* **經典 UDP DNS (連接埠 53)**：標準的 RFC 1035 UDP DNS 解析服務，可直接填入路由器 WAN/LAN 或系統 DNS 設定中。
* **DNS over TLS / DoT (連接埠 853)**：標準的 RFC 7858 加密 DNS，原生支援 Android 9+ 系統自帶的「私人 DNS」（Private DNS），並支援透過 SNI（如 `<profile_key>.dns.example.com`）自動路由到指定的 Profile。
* **Web 控制台與 DoH (預設連接埠 3000)**：全功能 React 管理面板與 REST API，開箱即用。
* **本地 SQLite 資料庫**：自動執行遷移腳本初始化資料表結構，無需任何雲端依賴。

#### 環境變數配置 (在 `.env.serverfull`、`.env` 或系統環境變數中配置)

| 環境變數 | 說明 | 預設值 / 範例 |
|---|---|---|
| `SERVERFULL_TLS_KEY_PATH` | TLS 私鑰檔案路徑 (PEM 格式，亦相容 `SERFULL_TLS_KEY_PATH`) | `/etc/letsencrypt/live/example.com/privkey.pem` |
| `SERVERFULL_TLS_CERT_PATH` | TLS 公鑰/憑證鏈檔案路徑 (PEM 格式，亦相容 `SERVERFULL_TLS_PUB_PATH`) | `/etc/letsencrypt/live/example.com/fullchain.pem` |
| `SERVERFULL_UDP_PORT` | 經典 UDP DNS 監聽連接埠 | `53` |
| `SERVERFULL_DOT_PORT` | DoT (TLS) 監聽連接埠 | `853` |
| `SERVERFULL_HTTP_PORT` | HTTP Web 面板與 DoH 監聽連接埠 | `3000` |
| `SERVERFULL_HOST` | 監聽位址 | `0.0.0.0` |
| `SERVERFULL_DB_PATH` | 本地 SQLite 資料庫檔案路徑 | `./data/dns_worker.sqlite` |
| `SERVERFULL_DEFAULT_PROFILE_KEY` | UDP DNS 或無 SNI 時的預設設定 Profile Key | 首個建立的 Profile |
| `JWT_SECRET` | 工作階段 Token 加密金鑰 | 自訂安全字串 |

#### 快速啟動

1. 複製程式碼倉庫並安裝依賴：
```bash
git clone https://github.com/Obein/DNS-Worker.git obexdns
cd obexdns
npm install
```

2. 配置環境變數：
專案內建提供開箱即用的設定檔範本 `.env.serverfull`。您可以直接修改，也可以複製為 `.env`：
```bash
cp .env.serverfull .env
nano .env
```

3. 編譯前端並啟動獨立服務：
```bash
npm run start:serverfull
```

4. 註冊為 Linux 系統常駐服務 (systemd)：
```bash
sudo npm run service-create:linux
sudo systemctl start dns-worker
sudo systemctl status dns-worker
```
該命令會自動產生 `/etc/systemd/system/dns-worker.service`，配置 `CAP_NET_BIND_SERVICE` 特權連接埠（53/853）綁定能力並配置開機自啟。

---

### 方案 B：☁️ Cloudflare Workers 邊緣模式 (無伺服器, 免維運)

依託 Cloudflare 全球 300+ 個城市的邊緣節點網路與 D1 資料庫運行，免除所有底層硬體與系統維護。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

#### 1. 線上控制台部署 (Cloudflare Dashboard)

1.  **Fork 本專案**：點擊頁面右上角的 `Fork` 按鈕，將倉庫複製到你的 GitHub 帳號下。
2.  **建立 D1 資料庫**：登入 Cloudflare 控制台，前往 `Workers & Pages` > `D1`，建立一個新的資料庫（例如命名為 `dns_worker_db`），並複製所建立的資料庫 ID。
3.  **配置資料庫 ID**：在你的 Fork 倉庫中，修改 `wrangler.toml` 檔案，將 `database_id` 替換為你剛才建立的資料庫 ID。
4.  **建立 Worker**：前往 Cloudflare 控制台 `Workers & Pages` > `Create application`。
5.  **從 GitHub 匯入並完成首次部署**：在部署頁面選擇 `Continue with GitHub`，關聯你 Fork 的專案並完成授權。在建構與部署設定 (Build & Deploy settings) 中如此填寫：
    *   **建構命令**: `npm run build`
    *   **部署命令**: `npm run deploy`
    *   **路徑**: `/`
    > ⚠️ **注意**：專案初始化精靈中的環境變數僅注入建構容器，執行階段的機密變數在初始化精靈中填寫無效。請直接點擊「部署」，待首次部署完成後，按後續步驟在 Worker 設定中填寫。
6.  **配置 JWT 金鑰**：首次部署完成後，登入 Cloudflare 控制台，前往 `Workers & Pages` > 點擊剛才建立的 Worker > `Settings` > `Runtime variables and secrets`（或 `Variables and secrets`） > 點擊 `Add`。將變數名稱設定為 `JWT_SECRET`，類型選擇 `機密 (Secret)`，值中輸入一個隨機安全字串，然後點擊 `Deploy`（或 `Save and Deploy`）儲存。
7.  **配置 KEK 啟用信封加密（選填）**：同樣在首次部署完成後的 `Settings` > `Runtime variables and secrets` 中，若要對 D1 資料庫中的敏感憑證（如 TOTP 金鑰和復原金鑰）啟用伺服器端信封加密，請新增一個名為 `KEK_v1`、類型為 `機密 (Secret)` 的變數，並輸入您的安全金鑰。在需要輪換 KEK 金鑰時，請按順序新增新的機密 `KEK_v(N+1)`（例如 `KEK_v2` -> `KEK_v3` 等）。

#### 2. 本地開發與命令列部署

##### 開發環境需求
- **Node.js**: v18.x 或更高版本（推薦 v22.5.0+）
- **Package Manager**: npm
- **Cloudflare Account**: 需要啟用 Workers 和 D1 權限

##### 部署步驟
```bash
# 1. 複製倉庫並安裝依賴
npm install

# 2. 初始化與遷移本地 D1 資料庫
npm run db:setup
npm run db:migrate:dev

# 3. 配置本地環境變數 (.dev.vars)
echo "JWT_SECRET=您的隨機安全JWT金鑰" > .dev.vars
echo "KEK_v1=您的隨機安全KEK金鑰" >> .dev.vars

# 4. 啟動本地開發服務
npm run dev

# 5. 手動部署上線至 Cloudflare
npm run deploy
```

---

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
    *   **D1 資料庫**: 選擇您剛剛建立的 `dns_worker_db` 資料庫。
5.  重新部署該 Pages 專案以使綁定生效。

---

## 💪 感謝與動力源

* [Cloudflare Workers](https://workers.cloudflare.com/) & [D1 Database](https://developers.cloudflare.com/d1/)
* [Node.js](https://nodejs.org/) (內建原生 `node:sqlite` 引擎)

## 🚚 核心技術與依賴

* [React](https://github.com/facebook/react) & [Blueprint](https://github.com/palantir/blueprint) (現代化企業級高密度 UI)
* [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
* [NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) (ML-KEM-768 後量子混合格密碼學)
* [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) (WebAssembly SQLite & OPFS 本地優先驅動)

---

## 📄 開源協定

本專案採用 [AGPLv3](LICENSE) 協定授權。

---

## 📝 總結

ObexDNS 讓您在完全自主掌控 DNS 解析的同時，無需在隱私、效能與靈活性之間做任何妥協。透過同時支援高效能 Node.js 獨立伺服器與 Cloudflare Workers 全球邊緣網路，它呈現了一個生產級的 Protective DNS 體系：

-   **雙引擎自由選擇**：既可完全脫離 Cloudflare 獨立運行於自有 VPS，獨享經典 UDP 53 與 DoT 853；亦可無伺服器部署於 Cloudflare 邊緣節點，享受零維護的全球 DoH 體驗。
-   **全協定覆蓋**：經典 UDP 53、Android 原生私人 DNS（DoT 853 配合 SNI 路由）及 DoH (RFC 8484)。
-   **後量子零知識 E2EE**：基於 NIST FIPS 203 **P256-MLKEM768** 與硬體通行密鑰 (WebAuthn)，全面防禦針對 DNS 隱私日誌的未來量子解密威脅。
-   **本機優先極速分析**：藉助瀏覽器端 SQLite WASM + OPFS 實現 0ms 瞬間查詢與圖表聚合，徹底告別頻繁消耗雲端資料庫讀取配額。
-   **精細策略掌控**：多配置隔離、重寫 ECH 抵禦 SNI 審查，以及布隆過濾器加速的百萬級廣告與惡意網域名稱攔截訂閱。

無論是保護單台行動裝置、整個家庭網路，還是跨地域的組織環境，ObexDNS 都提供了一個優雅且資料完全自主的替代方案。

<div align="center">
  <br>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
  <br><br>
  <b>如果 ObexDNS 對您有所幫助，請考慮給它一個 ⭐</b>
</div>
