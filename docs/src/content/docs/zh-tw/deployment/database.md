---
title: 資料庫部署指南與引擎選型
description: 詳解 DNS Worker 支援的三種資料庫儲存模式（Cloudflare D1、Turso / libSQL、本地檔案 SQLite）的架構特性、配置方法與適用場景。
---

DNS Worker 採用統一的資料抽象層設計，支援 **三種不同的資料庫儲存引擎**，能夠無縫覆蓋從 Cloudflare 全球邊緣節點到私有物理 VPS 乃至混合部署的各種場景。

```
┌──────────────────────────────────────────────────────────────────┐
│                   DNS Worker 数据访问层 (DAL)                     │
└──────────────┬───────────────────┬───────────────────┬───────────┘
               │                   │                   │
               ▼                   ▼                   ▼
    ┌────────────────────┐ ┌────────────────┐ ┌────────────────────┐
    │   Cloudflare D1    │ │ Turso / libSQL │ │ 本地文件 SQLite     │
    │ (Serverless 默认)   │ │ (全平台多端共享) │ │ (Serverfull 默认)   │
    └────────────────────┘ └────────────────┘ └────────────────────┘
```

---

## 1. 三種儲存模式特性對比

| 維度 / 模式 | ☁️ 模式一：Cloudflare D1 | 🌐 模式二：Turso / libSQL | 🖥️ 模式三：本地檔案 SQLite |
|---|---|---|---|
| **環境變數標識** | `DATABASE_SERVICE="D1"` | `DATABASE_SERVICE="Turso"` | `DATABASE_SERVICE="File"` |
| **首選執行環境** | Cloudflare Workers 邊緣 | **全平臺通用**（Workers + VPS） | Linux / VPS / Docker / Windows |
| **儲存介質** | 全球邊緣託管分散式 SQLite | libSQL 雲原生叢集 / 自建 sqld | 本地物理 NVMe / SSD 磁碟 |
| **網路協議** | Cloudflare 內部上下文繫結 | HTTPS / WebSocket (Hrana 協議) | 本地 VFS 檔案 I/O (`node:sqlite`) |
| **多節點資料同步** | Cloudflare 託管內部複製 | **強即時一致**（所有 Worker 與 VPS 共享同一庫） | 獨立單機（單節點獨佔） |
| **外部網路請求** | 無（記憶體級繫結） | 有（發起 outbound HTTPS 查詢） | 無（零網路請求） |
| **結構自動遷移** | 需執行 `wrangler d1 migrations` | **啟動/請求時全自動冪等應用** | **啟動時全自動冪等建表升級** |
| **運維複雜度** | 零運維 | 極低（註冊即可用） | 極低（無需外部服務） |

---

## 2. 模式一：Cloudflare D1 分散式資料庫

Cloudflare D1 是 Cloudflare Workers 原生整合的無伺服器分散式 SQL 資料庫，基於 SQLite 引擎構建，具有與 Worker 同機房就近讀取的特性。

### 適用場景
* 完全基於 Cloudflare 基礎設施部署 Serverless DoH 服務；
* 追求零基礎設施維護、開箱即用的高可用性；
* 單一 Cloudflare 賬號下的標準化部署。

### 部署與配置步驟

#### 1. 建立 D1 資料庫
在終端執行 Wrangler CLI（或登入 Cloudflare 網頁控制台建立）：
```bash
# 创建生产数据库
npx wrangler d1 create dns_worker_db
```
命令執行完畢後，控制台將輸出資料庫名稱與唯一的 `database_id`（UUID 格式）。

#### 2. 配置 `wrangler.toml`
在專案根目錄的 `wrangler.toml` 中配置 D1 繫結：
```toml
[[d1_databases]]
binding = "DB"
database_name = "dns_worker_db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
migrations_dir = "migrations"
```

#### 3. 執行資料庫遷移

:::note[執行遷移要求]
首次部署時必須執行資料遷移以初始化使用者、配置、規則與日誌資料表。
:::

```bash
# 本地开发测试环境初始化
npm run db:migrate:dev

# 生产远程 Cloudflare D1 初始化
npm run db:migrate:prod
```

#### 4. 環境變數設定（可選）
在 Cloudflare Workers 中，若未配置 `DATABASE_SERVICE`，系統預設回退為 `D1`。您亦可顯式在 `wrangler.toml` 中指定：
```toml
[vars]
DATABASE_SERVICE = "D1"
```

---

## 3. 模式二：Turso / libSQL 雲原生資料庫

Turso 是基於開源 **libSQL**（SQLite 的現代進化分支）打造的分散式邊緣資料庫，通過輕量級 Hrana 協議提供高速 HTTP/WebSocket 查詢介面。

### 核心價值：跨節點混合多活統一儲存
如果您同時部署了 **Cloudflare Workers 邊緣節點** 與 **一臺或多臺自建 VPS (Serverfull) 節點**：
* 傳統 D1 僅能被 Cloudflare Worker 訪問，無法直接接入物理 VPS；
* 本地 SQLite 檔案僅在當前 VPS 物理磁碟有效，無法在多臺伺服器或邊緣節點間共享；
* **Turso 完美打通了這一斷層**：無論是歐洲 VPS、亞太 VPS 還是全球 Cloudflare Workers，均可統一指向同一個 Turso 資料庫，實現**全域性統一賬號、即時同步的自定義攔截規則、統一的接入點配額與集中化查詢日誌**。

### 部署與配置步驟

#### 1. 註冊並建立 Turso 資料庫
1. 安裝 Turso CLI：
   ```bash
   curl -sSfL https://get.tur.so/install.sh | bash
   ```
2. 登入並建立資料庫例項：
   ```bash
   turso auth login
   turso db create dns-worker-db
   ```
3. 檢視資料庫訪問 URL：
   ```bash
   turso db show dns-worker-db --url
   # 输出格式类似: libsql://dns-worker-db-yourorg.turso.io
   ```
4. 建立長久訪問憑據 Token：
   ```bash
   turso db tokens create dns-worker-db
   # 输出一串长 JWT 格式字符串
   ```

#### 2. 在 Cloudflare Workers 中接入 Turso
在 `wrangler.toml` 中配置資料庫型別與連線地址：
```toml
[vars]
DATABASE_SERVICE = "Turso"
TURSO_DATABASE_URL = "https://dns-worker-db-yourorg.turso.io"
```

將 Auth Token 注入為加密金鑰（Secret）：
```bash
npx wrangler secret put TURSO_AUTH_TOKEN
# 粘贴刚刚生成的 Token
```

#### 3. 在獨立伺服器 / VPS (Serverfull) 中接入 Turso
在配置檔案 `/etc/dns-worker/.env` 或啟動目錄 `.env` 中加入：
```ini
DATABASE_SERVICE=Turso
TURSO_DATABASE_URL=libsql://dns-worker-db-yourorg.turso.io
TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQTEw...your_token
```

通過 CLI 啟停服務時即可生效：
```bash
sudo systemctl restart dns-worker
# 或
dns-worker start
```

:::tip[全自動資料遷移]
與 D1 不同，Turso 模式**無需手動執行 SQL 遷移檔案**。DNS Worker 內部封裝了基於 Hrana 管道協議的冪等遷移引擎，在服務初次啟動或邊緣節點初次處理請求時，會自動檢測並依次安全應用資料庫表結構升級。
:::

#### 4. 私有化部署自建 sqld 方案
若不希望使用 Turso 官方雲服務，您可以在內網或自備伺服器直接執行官方開源映象 `tursodatabase/sqld`：
```bash
docker run -d \
  --name sqld \
  -p 8080:8080 \
  -v /data/sqld:/var/lib/sqld \
  -e SQLD_AUTH_JWT_KEY="your_public_key" \
  tursodatabase/sqld:latest
```
此時將 `TURSO_DATABASE_URL` 設為 `http://your-sqld-host:8080` 即可完全私有化閉環。

---

## 4. 模式三：本地物理檔案 SQLite 資料庫

針對追求 100% 資料自主、不依賴任何雲端外部 API 的單機部署場景，DNS Worker 提供了基於宿主環境原生執行的本地 SQLite 引擎。

### 架構特性
* **零外部依賴**：直接呼叫 Node.js 原生標準庫模組 `node:sqlite`（Node.js >= 22.5 或 Bun >= 1.4 內建支援）；
* **極速磁碟 I/O**：預設配置 `PRAGMA journal_mode = WAL;` 與 `PRAGMA synchronous = NORMAL;`，具備高併發讀寫效能與抗斷電崩潰保護；
* **物理私有**：所有 DNS 查詢日誌與賬戶憑據完整儲存在本地單個 `.sqlite` 檔案中，斷網環境下依然完美運作。

### 預設持久化路徑
* **Linux / systemd**：`/var/lib/dns-worker/dns_worker.sqlite`
* **Windows**：`C:\ProgramData\DNS-Worker\dns_worker.sqlite`

### 部署與配置步驟

#### 1. 標準環境配置（`.env`）
在 `/etc/dns-worker/.env` 中配置：
```ini
DATABASE_SERVICE=File

# 可选：自定义数据文件路径（默认为 /var/lib/dns-worker/dns_worker.sqlite）
SERVERFULL_DB_PATH=/var/lib/dns-worker/dns_worker.sqlite
```

#### 2. Docker 容器持久化掛載
使用 Docker 執行獨立節點時，務必將資料庫持久化目錄掛載至宿主機：
```bash
docker run -d \
  --name dns-worker \
  --restart unless-stopped \
  -p 53:53/udp \
  -p 853:853/tcp \
  -p 10080:10080/tcp \
  -p 10443:10443/tcp \
  -v /var/lib/dns-worker:/var/lib/dns-worker \
  -v /etc/dns-worker:/etc/dns-worker \
  ghcr.io/obein/dns-worker:latest
```

#### 3. 資料備份與災難恢復
本地 SQLite 檔案的資料備份極為簡單：
```bash
# 在线安全热备份（利用 sqlite3 命令行）
sqlite3 /var/lib/dns-worker/dns_worker.sqlite ".backup /backup/dns_worker_$(date +%Y%m%d).sqlite"

# 或直接在停机维护时复制文件（需同时包含 -wal 与 -shm 文件，或执行 checkpoint）
cp /var/lib/dns-worker/dns_worker.sqlite /backup/
```

---

## 5. 引擎解析優先順序與智慧推斷機制

DNS Worker 在啟動時通過 `getDatabaseService(env, isServerfull)` 函式解析當前生效的資料庫引擎：

1. **顯式優先順序最高**：若環境變數或命令列引數指定了 `DATABASE_SERVICE`（如 `D1`、`Turso`、`File`，大小寫不敏感），系統將強制採用指定引擎；
2. **憑據智慧推斷**：若未顯式指定 `DATABASE_SERVICE`，但檢測到同時配置了非空的 `TURSO_DATABASE_URL` 與 `TURSO_AUTH_TOKEN`，系統將**自動啟用 Turso 模式**；
3. **平臺預設保底**：
   * Cloudflare Workers 環境預設回退為 `D1`；
   * 獨立伺服器 Serverfull (Node.js/Bun/Docker) 環境預設回退為 `File`。

---

## 6. 常見問題排查與注意事項

:::caution[平臺相容性限制]
* **`DATABASE_SERVICE="File"` 無法在 Cloudflare Workers 下使用**：Cloudflare Workers 是無物理持久磁碟的無伺服器邊緣沙箱，若在 Workers 下誤設為 `File`，系統將丟擲清晰的錯誤提示；
* **`DATABASE_SERVICE="D1"` 無法在獨立 VPS (Serverfull) 下使用**：D1 為 Cloudflare 專屬託管服務，VPS 獨立模式請選用 `File` 或 `Turso`。
:::

### 1. Turso 連線超時或協議報錯
* **URL 協議字首**：DNS Worker 會自動規範化 `libsql://` 與 `https://` 協議頭。如果您在 Workers 模式下遇到網路握手異常，請優先將 URL 字首寫為標準的 `https://...`。
* **Auth Token 過期**：使用 `turso db tokens create` 時可指定有效時長，若遇到 `401 Unauthorized` 錯誤，請重新生成 Token 並更新環境配置。

### 2. Linux 本地檔案許可權錯誤 (EACCES / Permission Denied)
* 服務預設執行在標準非 root 使用者環境。請確保資料目錄許可權正確：
  ```bash
  sudo mkdir -p /var/lib/dns-worker
  sudo chown -R $USER:$USER /var/lib/dns-worker
  sudo chmod 755 /var/lib/dns-worker
  ```

### 3. 檢視當前服務啟用的資料庫狀態
在 VPS 終端執行狀態指令，即可一目瞭然確認當前資料庫狀態與檔案尺寸：
```bash
dns-worker status
```
控制台將輸出當前連線的資料庫服務型別（`File`、`Turso`）、連線路徑或已連線記錄條數。
