<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>隱私優先 Protective DNS 解析器 & DoH / DoT 伺服端</p>
  <p>保護您的網際網路第一跳</p>
  <p align="center">
    <a href="README.md">English</a> | <a href="README_zh-CN.md">中文 (简体)</a> | 中文 (正體)
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![npm: dns-worker](https://img.shields.io/npm/v/dns-worker.svg?logo=npm&color=CB3837)](https://www.npmjs.com/dns-worker)
[![Docker: hugokoo/dns-worker](https://img.shields.io/badge/docker-hugokoo%2Fdns--worker-2496ED.svg?logo=docker)](https://hub.docker.com/r/hugokoo/dns-worker)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js / Bun](https://img.shields.io/badge/Runtime-Node.js%20%7C%20Bun-green.svg)](https://nodejs.org/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Docs: Astro Starlight](https://img.shields.io/badge/Docs-Astro%20Starlight-blueviolet.svg)](https://obein.github.io/DNS-Worker/)
[![Protocols: UDP 53 · DoT / DoQ · DoH (H2/H3)](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20%2F%20DoQ%20%7C%20DoH%20(H2%2FH3)-brightgreen.svg)](https://obein.github.io/DNS-Worker/deployment/matrix/)

</div>

---

## 📖 序

**DNS Worker** 是一套專為隱私、安全與效能而生的 Protective DNS 解析系統，原生支援廣告與惡意網域名稱攔截，採用獨創的**雙引擎架構**：

- **☁️ 邊緣模式 (Serverless)**：運作在 Cloudflare 全球 300+ 城市邊緣節點，配合 D1 資料庫享受零維護的高可用 DoH 服務（全面相容 HTTP/2 與 HTTP/3）。
- **🖥️ 獨立伺服器模式 (Serverfull)**：脫離 Cloudflare，運作在自有 VPS 或家用伺服器（Linux/Windows/macOS），原生支援經典 **UDP 53**、**DoT 853**（相容 DoQ 並支援 TLS SNI 路由，原生適配 Android 私有 DNS）與本地 SQLite；
- **🗄️ 多資料庫支援 (D1 / Turso / File)**：支援靈活配置底層儲存。除預設的 Cloudflare D1 (Serverless) 和本地 SQLite 檔案 (Serverfull) 外，更原生支援接入 **Turso**（分布式雲原生 SQLite）。無論在邊緣還是獨立伺服器，均可無縫切換至 Turso 資料庫，徹底緩解 Cloudflare 原生 D1 免費層級（每天 500 萬列讀取 / 10 萬列寫入）配額不足的痛點，從容承載高頻 DNS 日誌寫入。
- **🔀 多設定與多接入點支援**：靈活的策略隔離與裝置分流體系。支援為家庭成員、不同網路環境或客戶端建立多套相互隔離的設定（Profiles），每套設定可衍生多個專用接入點（Access Points）並配發獨立 Token，實現精細的裝置級識別、客製上游、獨立日誌審計與個人化攔截規則。

> 📚 **使用者文件**  
> 👉 [**https://obein.github.io/DNS-Worker/**](https://obein.github.io/DNS-Worker/)

### 快速上手

#### Cloudflare Workers 一鍵部署
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

#### 獨立主機極速運行 (npm)
```bash
# 全域安裝並啟動
npm install -g dns-worker
dns-worker config init
dns-worker
# 存取主控台: http://localhost:10080
```

#### 容器化一鍵部署 (Docker / Bun LTS)
```bash
# 背景啟動並直接對應 443 埠與 TLS 憑證（建議透過 443 存取；滿足憑證時 80 埠自動重新導向至 HTTPS）
docker run -d \
  --name dns-worker \
  --restart unless-stopped \
  -p 53:53/udp \
  -p 853:853/tcp \
  -p 80:80/tcp \
  -p 443:443/tcp \
  -v dns_worker_data:/var/lib/dns-worker \
  -v dns_worker_config:/etc/dns-worker \
  -v /etc/letsencrypt:/etc/ssl/dns-worker:ro \
  hugokoo/dns-worker:latest

# 存取主控台: https://your-domain-or-ip (設定憑證後，80 埠自動跳轉 HTTPS)
```

### 核心功能
- ⚡ **全棧協定**：UDP 53、DoT 853 (相容 DoQ RFC 9250)、DoH (相容 HTTP/2 與 HTTP/3)、ECH 與 DDR (RFC 9460)。
- 🔀 **多設定與多接入點支援**：支援按使用者、家庭成員或使用場景建立多套獨立設定（Profiles），每套設定可衍生多個專用接入點（Access Points）並配發專屬 Token，實現精準的裝置級識別、策略隔離與獨立統計。
- 🗄️ **多資料庫自由切換**：支援 `D1`、`Turso`、`File` 多種資料庫後端（透過 `DATABASE_SERVICE` 一鍵無縫切換），破解原生 D1 免費層用量限制。
- 🛡️ **後量子零知識 E2EE**：NIST FIPS 203 **P256-MLKEM768** 混合格密碼學 + 硬體通行金鑰（Passkey / WebAuthn）。
- 🚀 **本地優先 (Local-First)**：瀏覽器端 WebAssembly SQLite + OPFS，0ms 瞬間日誌查詢與統計分析。
- 🛡️ **精細防護與廣告攔截**：廣告與惡意網域名稱攔截、萬用字元過濾、百萬級外部規則布隆過濾器秒級命中、自訂解析覆蓋與 ECH 偽裝。

---

## 🔎 預覽

| 分析統計 | 解析目的地 |
|:---:|:---:|
| ![統計分析](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![解析目的地](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) |

| 多接入點與端點設定 | 規則設定 |
|:---:|:---:|
| ![多接入點](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-endpoints.webp) | ![規則設定](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) |

| 外部攔截列表 | 解析日誌 |
|:---:|:---:|
| ![過濾列表](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) | ![解析日誌](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) |

| 行動端統計 | 行動端日誌 |
|:---:|:---:|
| ![行動端統計](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) | ![行動端日誌](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_log.webp) |

> 💡 更多功能展示與端點設定，請部署後存取 Web 主控台或參閱 [官方文件](https://obein.github.io/DNS-Worker/)。

---

## 💪 動力

DNS Worker 的誕生與演進得益於現代開源生態的卓越基礎設施與密碼學成果：

- **運算與執行環境**：[Node.js](https://nodejs.org/)（原生內建 `node:sqlite`）/ [Bun](https://bun.sh/) (>= 1.4.0) 與 [Cloudflare Workers](https://workers.cloudflare.com/) + [D1 Database](https://developers.cloudflare.com/d1/) / [Turso](https://turso.tech/) (libSQL)
- **使用者介面**：[React](https://github.com/facebook/react)、[Blueprint](https://github.com/palantir/blueprint) 與 [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
- **文件體系**：[Astro](https://astro.build/) & [Starlight](https://starlight.astro.build/)（極速靜態文件驅動）
- **密碼學與資料儲存**：[NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) (ML-KEM-768) 與 [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) (WASM + OPFS 本地優先驅動)

---

## 📄 開源授權

本專案採用 [AGPL-3.0](LICENSE) 開源授權。

<div align="center">
  <br>
  <b>如果 DNS Worker 對您有所幫助，請考慮給它一個 ⭐</b>
</div>
