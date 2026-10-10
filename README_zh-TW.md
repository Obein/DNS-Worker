<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>隱私優先 Protective DNS 解析器 & DoH / DoT 伺服端</p>
  <p>保護您的網際網路第一跳</p>
  <p align="center">
    <a href="README.md">English</a> | <a href="README_zh-CN.md">中文 (简体)</a> | 中文 (正體)
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js / Bun](https://img.shields.io/badge/Runtime-Node.js%20%7C%20Bun-green.svg)](https://nodejs.org/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Docs: Astro Starlight](https://img.shields.io/badge/Docs-Astro%20Starlight-blueviolet.svg)](https://obein.github.io/DNS-Worker/)
[![Protocols: UDP 53 · DoT 853 · DoH](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20853%20%7C%20DoH-brightgreen.svg)](https://obein.github.io/DNS-Worker/deployment/matrix/)

</div>

---

## 📖 序

**DNS Worker** 是一套專為隱私與效能而生的 Protective DNS 解析系統，採用獨創的**雙引擎架構**：

- **☁️ 邊緣模式 (Serverless)**：運作在 Cloudflare 全球 300+ 城市邊緣節點，配合 D1 資料庫享受零維護的高可用 DoH 服務。
- **🖥️ 獨立伺服器模式 (Serverfull)**：脫離 Cloudflare，運作在自有 VPS 或家用伺服器（Linux/Windows/macOS），原生支援經典 **UDP 53**、**DoT 853**（TLS SNI 路由，原生適配 Android 私有 DNS）與本地 SQLite；

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

### 核心功能
- ⚡ **全棧協定**：UDP 53、DoT 853、DoH (HTTP/2 & HTTP/3)、DoQ (RFC 9250)、ECH 與 DDR (RFC 9460)。
- 🛡️ **後量子零知識 E2EE**：NIST FIPS 203 **P256-MLKEM768** 混合格密碼學 + 硬體通行金鑰（Passkey / WebAuthn）。
- 🚀 **本地優先 (Local-First)**：瀏覽器端 WebAssembly SQLite + OPFS，0ms 瞬間日誌查詢與統計分析。
- 🛡️ **精細防護策略**：萬用字元過濾、百萬級外部規則布隆過濾器秒級命中、自訂解析覆蓋與 ECH 偽裝。

---

## 🖼️ 預覽

| 分析統計 | 解析目的地 |
|:---:|:---:|
| ![統計分析](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![解析目的地](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) |

| 規則設定 | 外部攔截列表 |
|:---:|:---:|
| ![規則設定](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) | ![過濾列表](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) |

| 解析日誌 | 行動端適配 |
|:---:|:---:|
| ![解析日誌](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) | ![行動端統計](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) |

> 💡 更多功能展示與端點設定，請部署後存取 Web 主控台或參閱 [官方文件](https://obein.github.io/DNS-Worker/)。

---

## 💪 動力

DNS Worker 的誕生與演進得益於現代開源生態的卓越基礎設施與密碼學成果：

- **運算與執行環境**：[Node.js](https://nodejs.org/)（原生內建 `node:sqlite`）/ [Bun](https://bun.sh/) (>= 1.4.0) 與 [Cloudflare Workers](https://workers.cloudflare.com/) + [D1 Database](https://developers.cloudflare.com/d1/)
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
