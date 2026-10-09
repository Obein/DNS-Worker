---
title: 域名过滤与规则引擎
description: 规则订阅管理、自定义黑白名单、布隆过滤器加速架构以及过滤环境变量配置手册。
sidebar:
  order: 1
---

DNS Worker 拥有企业级域名防护过滤引擎，可在极低内存开销下快速评估数十万条去广告与防跟踪规则，达到亚毫秒级拦截响应。本指南介绍规则订阅操作、自定义规则语法、底层算法设计及相关环境变量。

---

## 1. Web 仪表盘规则管理操作

### 添加外部规则订阅
1. 登录控制台后，在侧边栏进入 **规则订阅**（Filters）。
2. 在 **外部规则源** 模块中，点击 **添加订阅**（Add Subscription）。
3. 填入订阅源 URL（支持标准 Adblock Plus、Hosts 或纯域名列表格式）。
4. 常用推荐规则源：
   - **OISD Big**：`https://big.oisd.nl`
   - **AdGuard Base**：`https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt`
   - **HaGeZi Multi PRO**：`https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt`
5. 点击 **保存并同步**，系统将自动拉取并将规则编译入内存。

### 自定义黑白名单
您可以在各接入点中单独定义特定域名放行或拦截：
- **白名单（Allowlist）**：即便命中第三方广告规则也会无条件放行的域名。
- **黑名单（Blocklist）**：强制拦截的恶意或隐私收集域名。
- **支持语法**：
  - 精确域名：`ad.example.com`
  - 通配符匹配：`*.telemetry.domain.com`
  - 正则表达式：`^analytics-[0-9]+\..*$`

### 拦截动作模式 (Block Modes)
在接入点设置中，可自由选择拦截返回方式：

| 拦截模式 | 返回报文行为 | 特点与适用场景 |
| :--- | :--- | :--- |
| **零 IP 拦截 (0.0.0.0 / ::)** | IPv4 返回 `0.0.0.0`，IPv6 返回 `::` | **推荐默认**。终端立即握手失败并终止重试，网页加载最快。 |
| **NXDOMAIN** | 返回 RCODE 3（域名不存在） | 符合标准语义，告知客户端此域名无任何解析记录。 |
| **Refused** | 返回 RCODE 5（拒绝查询） | 明确告知客户端解析被策略拒绝。 |

---

## 2. 核心架构：双层布隆过滤器与前缀树 (Trie)

为了在低资源环境（如 512MB 内存 VPS 或 Cloudflare 128MB Workers）下支撑超大规模规则库，DNS Worker 采用了 **双层布隆过滤器 (Bloom Filter)** 加速架构：

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

1. **布隆过滤器初筛**：超过 99% 的合法正常域名可在 $O(1)$ 时间内瞬间放行，无需查库与深层遍历。
2. **前缀树精确校验**：仅当布隆过滤器判定可能命中时才调用精确前缀匹配，既消除计算开销，又确保绝不误杀。

---

---

## 3. 过滤环境变量参考手册

请在 `.env`（独立服务器）或 `wrangler.toml`（Cloudflare Workers）中配置：

### `PRESET_EXTERNAL_FILTERS`
- **支持模式**：Serverless 与 Serverfull
- **`wrangler.toml` 格式**：包含 `{ label, url }` 对象的多行 TOML 数组。
- **`.env.serverfull` 格式**：JSON 格式字符串。
- **默认值**：内置 OISD Big (`https://big.oisd.nl`)、OISD NSFW、AdGuard Base 以及 StevenBlack 等精选规则源。

### `BLOOM_FALSE_POSITIVE_RATE`
- **支持模式**：Serverless 与 Serverfull
- **默认值 (`wrangler.toml`)**：`0.0001`（万分之一）
- **默认值 (`.env.serverfull`)**：`0.0001`
- **说明**：布隆过滤器位图大小的容错阈值。极低误碰率（0.0001）大幅降低了二次复核计算，消除高频解析时的 CPU 峰值。

### `MAX_SYNC_DOMAINS` 与 `MAX_LIST_DOMAINS`
- **支持模式**：Serverless 与 Serverfull
- **默认值**：`MAX_SYNC_DOMAINS=1000000`（单配置 100 万条域名），`MAX_LIST_DOMAINS=500000`（单列表 50 万条）。
- **说明**：防止拉取异常庞大的超限外部规则导致内存超额溢出。

### `BLOOM_MEM_TTL` 与 `SYNC_TIMEOUT_MS`
- **默认值**：`BLOOM_MEM_TTL=600000`（内存布隆过滤器驻留 10 分钟），`SYNC_TIMEOUT_MS=30000`（规则下载超时 30 秒）。
- **说明**：编译后的布隆过滤器位图在内存中的保鲜期，以及同步外部列表时的最大网络等待时长。

### `SUBSTITUTE_DOMAIN`
- **支持模式**：Serverless 与 Serverfull
- **默认值**：`www.okx.com`
- **说明**：用于健康探测与上游可用性检测的探针测试域名。

### `BLOCK_MODE`
- **支持模式**：Serverless 与 Serverfull
- **默认值**：`zero_ip`（`0.0.0.0` / `::`）
- **可选值**：`zero_ip`、`nxdomain`、`refused`
- **说明**：全局默认的域名拦截响应行为（当具体接入点未单独覆盖时生效）。
