---
title: 專案概述
description: 瞭解 DNS Worker 的設計哲學、雙引擎架構與核心能力。
---

## 什麼是 DNS Worker？

**DNS Worker** 是一套專為現代隱私與防護而設計的 Protective DNS 解析系統，採用**雙引擎架構（Dual-Engine Architecture）**：

1. **☁️ 邊緣模式 (Cloudflare Workers Serverless / 首選推薦)**：
   免運維執行在 Cloudflare 全球 300+ 城市的分散式邊緣節點，搭配 D1 分散式資料庫，享受零伺服器維護成本、全球 Anycast 就近加速與亞毫秒級極速響應。
2. **🖥️ 獨立伺服器模式 (Serverfull / 自建可選方案)**：
   完全脫離 Cloudflare 基礎設施，直接執行在您的自有 VPS、家用 Linux / Windows 主機上。採用 Node.js 原生內建 `node:sqlite` 儲存，原生監聽經典 UDP 53、DoT 853（基於 TLS SNI 路由）與 Web 面板 / DoH。

---

## 協議與核心能力

### 1. 全協議覆蓋
* **經典 UDP 53 (RFC 1035)**：為路由器和內網裝置提供即插即用的原生 DNS 解析。
* **DoT 853 (RFC 7858)**：基於 TLS 加密傳輸，原生適配 Android 9+“私有 DNS”，通過 TLS SNI 實現多配置自動路由（如 `<profileKey>.dns.example.com`）。
* **DoH (RFC 8484)**：支援 HTTP/2 與 HTTP/3 (Alt-Svc) 加密解析，相容主流現代瀏覽器。
* **DoQ (RFC 9250)**：支援基於 QUIC 的 0-RTT 極速握手，無隊頭阻塞。
* **ECH 與 DDR (RFC 9460)**：廣播 Encrypted Client Hello 引數與外層偽裝 SNI，配合 DDR 實現加密 DNS 自動發現。

### 2. 本地優先 (Local-First) 架構
基於瀏覽器端原生 OPFS (Origin Private File System) 與 WebAssembly SQLite，使用者端查詢日誌和聚合統計全部在本地 0ms 瞬間渲染，支援離線分析，後臺自動執行輕量雙向同步，大幅節省資料庫計費與頻寬。

### 3. 後量子零知識端到端加密 (E2EE)
引入 NIST FIPS 203 **P256-MLKEM768** 混合格密碼學，配合硬體通行金鑰（WebAuthn / Passkey）及恢復金鑰。伺服器只儲存高強度加密密文，解密與私鑰計算嚴格限定在使用者的受信任裝置內。
