---
title: 域名過濾與規則引擎
description: 規則訂閱管理、自定義黑白名單、布隆過濾器加速架構以及過濾環境變數配置手冊。
sidebar:
  order: 1
---

DNS Worker 擁有企業級域名防護過濾引擎，可在極低記憶體開銷下快速評估數十萬條去廣告與防跟蹤規則，達到亞毫秒級攔截響應。本指南介紹規則訂閱操作、自定義規則語法、底層演算法設計及相關環境變數。

---

## 1. Web 儀表盤規則管理操作

### 新增外部規則訂閱
1. 登入控制台後，在側邊欄進入 **規則訂閱**（Filters）。
2. 在 **外部規則源** 模組中，點選 **新增訂閱**（Add Subscription）。
3. 填入訂閱源 URL（支援標準 Adblock Plus、Hosts 或純域名列表格式）。
4. 常用推薦規則源：
   - **OISD Big**：`https://big.oisd.nl`
   - **AdGuard Base**：`https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt`
   - **HaGeZi Multi PRO**：`https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt`
5. 點選 **儲存並同步**，系統將自動拉取並將規則編譯入記憶體。

### 自定義黑白名單
您可以在各接入點中單獨定義特定域名放行或攔截：
- **白名單（Allowlist）**：即便命中第三方廣告規則也會無條件放行的域名。
- **黑名單（Blocklist）**：強制攔截的惡意或隱私收集域名。
- **支援語法**：
  - 精確域名：`ad.example.com`
  - 萬用字元匹配：`*.telemetry.domain.com`
  - 正規表示式：`^analytics-[0-9]+\..*---
title: 域名過濾與規則引擎
description: 規則訂閱管理、自定義黑白名單、布隆過濾器加速架構以及過濾環境變數配置手冊。
sidebar:
  order: 1
---

DNS Worker 擁有企業級域名防護過濾引擎，可在極低記憶體開銷下快速評估數十萬條去廣告與防跟蹤規則，達到亞毫秒級攔截響應。本指南介紹規則訂閱操作、自定義規則語法、底層演算法設計及相關環境變數。

---

## 1. Web 儀表盤規則管理操作

### 新增外部規則訂閱
1. 登入控制台後，在側邊欄進入 **規則訂閱**（Filters）。
2. 在 **外部規則源** 模組中，點選 **新增訂閱**（Add Subscription）。
3. 填入訂閱源 URL（支援標準 Adblock Plus、Hosts 或純域名列表格式）。
4. 常用推薦規則源：
   - **OISD Big**：`https://big.oisd.nl`
   - **AdGuard Base**：`https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt`
   - **HaGeZi Multi PRO**：`https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt`
5. 點選 **儲存並同步**，系統將自動拉取並將規則編譯入記憶體。

### 自定義黑白名單
您可以在各接入點中單獨定義特定域名放行或攔截：
- **白名單（Allowlist）**：即便命中第三方廣告規則也會無條件放行的域名。
- **黑名單（Blocklist）**：強制攔截的惡意或隱私收集域名。
- **支援語法**：
  - 精確域名：`ad.example.com`
  - 萬用字元匹配：`*.telemetry.domain.com`
  - 正規表示式：

### 攔截動作模式 (Block Modes)
在接入點設定中，可自由選擇攔截返回方式：

| 攔截模式 | 返回報文行為 | 特點與適用場景 |
| :--- | :--- | :--- |
| **零 IP 攔截 (0.0.0.0 / ::)** | IPv4 返回 `0.0.0.0`，IPv6 返回 `::` | **推薦預設**。終端立即握手失敗並終止重試，網頁載入最快。 |
| **NXDOMAIN** | 返回 RCODE 3（域名不存在） | 符合標準語義，告知客戶端此域名無任何解析記錄。 |
| **Refused** | 返回 RCODE 5（拒絕查詢） | 明確告知客戶端解析被策略拒絕。 |

---

## 2. 核心架構：雙層布隆過濾器與字首樹 (Trie)

為了在低資源環境（如 512MB 記憶體 VPS 或 Cloudflare 128MB Workers）下支撐超大規模規則庫，DNS Worker 採用了 **雙層布隆過濾器 (Bloom Filter)** 加速架構：

```
传入解析请求 (例如: adserver.tracker.com)
                │
                ▼
┌─────────────────────────────────┐
│ 布隆过滤器快速初筛              │
│ (极低内存位图，内存占用 < 2MB)  │
└─────────────────────────────────┘
        │                 │
    (未命中)           (命中可能存在)
        │                 ▼
        │     ┌─────────────────────────────────┐
        │     │ 前缀树 (Trie) 精确复核          │
        │     │ (彻底杜绝布隆过滤器误杀)        │
        │     └─────────────────────────────────┘
        │                 │                 │
        ▼                 ▼                 ▼
   [ 直接放行 ]       [ 执行拦截 ]       [ 精确放行 ]
```

1. **布隆過濾器初篩**：超過 99% 的合法正常域名可在 $O(1)$ 時間內瞬間放行，無需查庫與深層遍歷。
2. **字首樹精確校驗**：僅當布隆過濾器判定可能命中時才呼叫精確字首匹配，既消除計算開銷，又確保絕不誤殺。

---

---

## 3. 過濾環境變數參考手冊

請在 `.env`（獨立伺服器）或 `wrangler.toml`（Cloudflare Workers）中配置：

### `PRESET_EXTERNAL_FILTERS`
- **支援模式**：Serverless 與 Serverfull
- **`wrangler.toml` 格式**：包含 `{ label, url }` 物件的多行 TOML 陣列。
- **`.env.serverfull` 格式**：JSON 格式字串。
- **預設值**：內建 OISD Big (`https://big.oisd.nl`)、OISD NSFW、AdGuard Base 以及 StevenBlack 等精選規則源。

### `BLOOM_FALSE_POSITIVE_RATE`
- **支援模式**：Serverless 與 Serverfull
- **預設值 (`wrangler.toml`)**：`0.0001`（萬分之一）
- **預設值 (`.env.serverfull`)**：`0.0001`
- **說明**：布隆過濾器點陣圖大小的容錯閾值。極低誤碰率（0.0001）大幅降低了二次複核計算，消除高頻解析時的 CPU 峰值。

### `MAX_SYNC_DOMAINS` 與 `MAX_LIST_DOMAINS`
- **支援模式**：Serverless 與 Serverfull
- **預設值**：`MAX_SYNC_DOMAINS=1000000`（單配置 100 萬條域名），`MAX_LIST_DOMAINS=500000`（單列表 50 萬條）。
- **說明**：防止拉取異常龐大的超限外部規則導致記憶體超額溢位。

### `BLOOM_MEM_TTL` 與 `SYNC_TIMEOUT_MS`
- **預設值**：`BLOOM_MEM_TTL=600000`（記憶體布隆過濾器駐留 10 分鐘），`SYNC_TIMEOUT_MS=30000`（規則下載超時 30 秒）。
- **說明**：編譯後的布隆過濾器點陣圖在記憶體中的保鮮期，以及同步外部列表時的最大網路等待時長。

### `SUBSTITUTE_DOMAIN`
- **支援模式**：Serverless 與 Serverfull
- **預設值**：`www.okx.com`
- **說明**：用於健康探測與上游可用性檢測的探針測試域名。

### `BLOCK_MODE`
- **支援模式**：Serverless 與 Serverfull
- **預設值**：`zero_ip`（`0.0.0.0` / `::`）
- **可選值**：`zero_ip`、`nxdomain`、`refused`
- **說明**：全域性預設的域名攔截響應行為（當具體接入點未單獨覆蓋時生效）。
