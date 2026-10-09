---
title: 上游解析與網路架構
description: 遞迴上游解析引擎、ECH 隱私混淆、GeoIP 分流機制與完整網路環境變數配置參考。
sidebar:
  order: 2
---

DNS Worker 作為客戶端與根遞迴解析器之間的智慧防護樞紐。本文件詳細剖析上游轉發流程、加密客戶端 Hello (ECH) 隱私加固、GeoIP 智慧路由以及相關網路環境變數。

---

## 1. 上游解析引擎與協議支援

DNS Worker 支援高併發的多協議遞迴查詢轉發：

```
[ 客户端设备 ]
        │  (DoH / DoT / UDP)
        ▼
┌────────────────────────────────────────────────────────┐
│ DNS Worker 解析引擎                                    │
│  ├─ 域名规则评估与本地黑白名单匹配                      │
│  ├─ 高速缓存与 ECS (EDNS Client Subnet) 注入            │
│  └─ 多路复用上游调度器                                  │
└────────────────────────────────────────────────────────┘
        │
   ┌────┴───────────────────────────┬──────────────────────┐
   ▼                                ▼                      ▼
[ DoQ / QUIC 上游 ]        [ DoH + ECH 上游 ]      [ DoT / TLS 上游 ]
 (RFC 9250 - quic://)       (RFC 8484 / RFC 9460)    (RFC 7858 - tls://)
```

### 支援的上游 URI 協議格式
在 Web 控制台或環境變數中配置自定義上游時，支援如下協議字首：

- **經典 UDP / TCP**：`udp://1.1.1.1:53` 或直接填 IP `1.1.1.1`
- **DNS over TLS (DoT)**：`tls://dns.quad9.net` 或 `tls://1.0.0.1:853`
- **DNS over HTTPS (DoH)**：`https://cloudflare-dns.com/dns-query`
- **DNS over QUIC (DoQ)**：`quic://dns.adguard-dns.com` 或 `doq://9.9.9.9:853`

---

## 2. ECH (Encrypted Client Hello) 隱私防嗅探

在使用 DoH 或 HTTPS 向上遊發起解析時，傳統 TLS 握手會在明文中暴露 **SNI (伺服器名稱指示)**，使中間運營商或網路監聽者仍能探知您的解析去向。

DNS Worker 原生整合 **RFC 9460 / RFC 8484 加密客戶端 Hello (ECH)** 技術：
- 外發 DoH 請求會根據目標服務釋出的 HTTPS/SVCB 記錄自動加密內層 SNI。
- 開啟後，中間網路觀察者僅能看到用於偽裝的公共前置域名（如 `cloudflare-ech.com`），無法獲知真實的遞迴上游目標。

---

## 3. GeoIP 與 ECS 客戶端子網智慧分流

為防止 CDN 因遞迴代理而將國內或特定地區使用者引導至異地邊緣節點，DNS Worker 支援智慧 EDNS Client Subnet (ECS) 轉發：
- **子網精度裁剪**：僅向上遊傳遞經過脫敏截斷的 `/24` (IPv4) 或 `/48` (IPv6) 網段資訊，在保留 CDN 就近排程能力的同時保護使用者完整 IP 隱私。
- **區域智慧分流**：根據 `IP_REGION` 列表對請求進行國內外判定，自動選擇最優上游叢集。

---

---

## 4. 網路配置差異對比：Serverless 與 Serverfull

由於 Cloudflare Workers 執行在邊緣無伺服器環境，而 Serverfull 模式直接監聽宿主機作業系統網路堆疊，兩者的配置引數存在顯著架構差異：

| 網路引數 | Serverless (`wrangler.toml`) | Serverfull (`.env.serverfull`) | 架構差異與設計邏輯 |
| :--- | :--- | :--- | :--- |
| **監聽網絡卡繫結** | 不適用（Cloudflare Anycast 託管） | `SERVERFULL_HOST=0.0.0.0` | Serverfull 需直接監聽物理主機網絡卡介面。 |
| **UDP DNS 埠** | 邊緣環境原生不支援直接監聽 | `SERVERFULL_UDP_PORT=53` | Serverfull 繫結系統原生 UDP 53 埠。 |
| **DoT 監聽埠** | 邊緣環境原生不支援直接監聽 | `SERVERFULL_DOT_PORT=853` | Serverfull 繫結系統原生 TLS 853 埠。 |
| **Web 儀表盤 / DoH (HTTP)** | 不適用 | `SERVERFULL_HTTP_PORT=10080` | 本地內網反向代理 / 面板 HTTP 埠。 |
| **Web 儀表盤 / DoH (HTTPS)** | 不適用（由 Cloudflare CDN 443 託管） | `SERVERFULL_HTTPS_PORT=10443` | 載入 TLS 證書後直連暴露的加密 HTTPS 埠。 |
| **DoT 對外基準域名** | 不適用 | `SERVERFULL_DOT_DOMAIN=dns.example.com` | Serverfull 用於 Android 私密 DNS 與 SNI 路由匹配。 |
| **ECH 混淆模式** | `PRESET_ECH_FRONTING_DOMAINS`（JSON 陣列） | `SERVERFULL_ECH_ENABLED=true` | Serverfull 動態合成 RFC 9460 HTTPS/SVCB ECH 響應。 |
| **緊急兜底上游** | `FAIL_OPEN_UPSTREAM` | `FAIL_OPEN_UPSTREAM` | 兩者一致（`https://freedns.controld.com/no-ads-malware-typo`）。 |

---

## 5. 網路環境變數參考手冊

### 上游 DNS 變數

#### `FAIL_OPEN_UPSTREAM`
- **支援模式**：Serverless 與 Serverfull
- **預設值 (`wrangler.toml`)**：`https://freedns.controld.com/no-ads-malware-typo`
- **預設值 (`.env.serverfull`)**：`https://freedns.controld.com/no-ads-malware-typo`
- **說明**：當所有常規上游解析池超時或遭遇致命故障時的緊急回退解析器。支援 HTTPS (DoH)、DoT (`tls://`)、TCP (`tcp://`) 及 DNS Stamps (`sdns://`)。

#### `PRESET_UPSTREAMS`
- **支援模式**：Serverless 與 Serverfull
- **格式 (`wrangler.toml`)**：包含 `label` 與 `url` 物件的 JSON 陣列 TOML 多行文本。
- **格式 (`.env.serverfull`)**：單行或多行 JSON 字串。
- **預設值**：涵蓋 Cloudflare Security、Quad9 ECS、AdGuard 以及 Google DNS 的高可用叢集。

---

### ECH (Encrypted Client Hello) 變數

#### `PRESET_ECH_FRONTING_DOMAINS` *(僅 Serverless)*
- **型別**：JSON 字串陣列
- **預設值**：`["cloudflare-ech.com", "crypto.cloudflare.com", "one.one.one.one", "www.cloudflare.com", "encryptedsni.com", "cdnjs.com"]`
- **說明**：Cloudflare Worker 向外發起遞迴請求時用於偽裝外層 SNI 的候選掩護域名池。

#### `SERVERFULL_ECH_ENABLED` 與 `SERVERFULL_ECH_FRONTING_DOMAIN` *(僅 Serverfull)*
- **型別**：`boolean` 與 `string`
- **預設值**：`SERVERFULL_ECH_ENABLED=true`，`SERVERFULL_ECH_FRONTING_DOMAIN=cloudflare-ech.com`
- **說明**：控制 Serverfull 守護程序是否在客戶端查詢 HTTPS/SVCB 及 DDR 時動態注入 ECHConfig 引數，並定義外層握手偽裝域名。

---

### 服務監聽與埠繫結變數 *(僅 Serverfull)*

#### `SERVERFULL_HOST`
- **預設值**：`0.0.0.0`
- **說明**：監聽的本地 IP 介面。若配置 Nginx/Caddy 反向代理可設為 `127.0.0.1`。

#### `SERVERFULL_UDP_PORT`（或 `SERVERFULL_PORT`）
- **預設值**：`53`
- **說明**：RFC 1035 UDP DNS 埠。監聽需 root 或 `CAP_NET_BIND_SERVICE` 許可權。

#### `SERVERFULL_DOT_PORT`
- **預設值**：`853`
- **說明**：RFC 7858 DNS over TLS 監聽埠。

#### `SERVERFULL_HTTP_PORT` 與 `SERVERFULL_HTTPS_PORT`
- **預設值**：`10080` (HTTP) 與 `10443` (HTTPS)
- **說明**：Web 控制台及 DoH 解析埠。當通過 `SERVERFULL_TLS_CERT_PATH` 與 `SERVERFULL_TLS_KEY_PATH` 載入證書後，HTTPS 埠自動啟用。

#### `SERVERFULL_DOT_DOMAIN`
- **預設值**：`dns.example.com`
- **說明**：DoT 及安卓私密 DNS 基準域名。需配置萬用字元解析記錄（`*.your.domain`）及對應的有效 TLS 證書。
