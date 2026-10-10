---
title: 架構與部署選型
description: Cloudflare Workers 邊緣模式 (首選推薦) 與獨立伺服器 Serverfull 模式全維度特性對比矩陣。
---

無論您看重全球 300+ 節點的零運維免託管與極速 Anycast 加速，還是追求 100% 資料主權並在區域網路由器通過 UDP 53 及 Android DoT 853 接入，DNS Worker 均提供亞毫秒級規則匹配、本地優先統計與後量子零知識加密審計日誌。

## 雙引擎特性對比矩陣

| 特性維度 | ☁️ Cloudflare Workers 邊緣模式 (首選推薦) | 🖥️ 獨立伺服器 / VPS (Serverfull 自建可選) |
|---|---|---|
| **核心價值** | **全球極速 Anycast 邊緣加速、免伺服器運維** | 100% 資料自主、家庭區域網與路由器 UDP 53、安卓 DoT |
| **執行平臺** | **Cloudflare 全球 300+ 邊緣資料中心** | Linux / VPS / macOS / Windows (`Node.js >= 22.5` / `Bun >= 1.4`) |
| **儲存後端** | **Cloudflare D1 (全球分散式 SQL 資料庫)** | 原生內建 SQLite (`node:sqlite`) |
| **支援協議** | **DoH** (RFC 8484，支援 HTTP/2 與 HTTP/3) | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** |
| **運維成本** | **完全零伺服器運維**，全球彈性自適應伸縮 | 需自行維護伺服器作業系統、防火牆規則與常駐服務 |
| **路由器 / 內網接入** | 需前置 DoH 轉發客戶端（如 OpenWrt、AdGuard Home） | **原生支援 UDP 53**（路由器 DNS 直接填寫伺服器 IP） |
| **安卓原生私密 DNS** | 需配合 DoH 模板或第三方 App | **原生支援 DoT 853**（支援 SNI 路由 `<token>.dns.example.com`） |
| **後量子零知識 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **本地優先 Web 儀表盤** | ✅ 瀏覽器端 SQLite WASM + OPFS 0ms 閃電查詢 | ✅ 瀏覽器端 SQLite WASM + OPFS 0ms 閃電查詢 |
| **硬體與成本要求** | **完全適用 Cloudflare 免費套餐** | 基於自有 VPS、小主機或家庭 NAS 執行 |

---

## 我該如何選擇？

### ☁️ 選擇 Cloudflare Workers 邊緣模式 (首選推薦)
- 追求**完全省心免維護**，無需為作業系統升級、程序掛掉或網路波動操心；
- 經常跨地域/跨國出行，需要全球 300+ 節點就近接入與極低解析延遲；
- 零硬體成本，完全基於 Cloudflare 免費配額即可穩定執行。

### 🖥️ 選擇獨立伺服器 / VPS 模式 (Serverfull 自建方案)
- 需要為家庭區域網、智慧電視或傳統 IoT 路由器提供原生 UDP 53 無感攔截；
- 希望在 Android 系統設定中直接填入“私密 DNS”域名（853 埠）且不想安裝第三方 App；
- 堅持將所有 DNS 查詢歷史與日誌資料嚴格儲存在自有 NVMe 物理硬碟中。
