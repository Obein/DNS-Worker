---
title: 上游解析与网络架构
description: 递归上游解析引擎、ECH 隐私混淆、GeoIP 分流机制与完整网络环境变量配置参考。
sidebar:
  order: 2
---

DNS Worker 作为客户端与根递归解析器之间的智能防护枢纽。本文档详细剖析上游转发流程、加密客户端 Hello (ECH) 隐私加固、GeoIP 智能路由以及相关网络环境变量。

---

## 1. 上游解析引擎与协议支持

DNS Worker 支持高并发的多协议递归查询转发：

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

### 支持的上游 URI 协议格式
在 Web 控制台或环境变量中配置自定义上游时，支持如下协议前缀：

- **经典 UDP / TCP**：`udp://1.1.1.1:53` 或直接填 IP `1.1.1.1`
- **DNS over TLS (DoT)**：`tls://dns.quad9.net` 或 `tls://1.0.0.1:853`
- **DNS over HTTPS (DoH)**：`https://cloudflare-dns.com/dns-query`
- **DNS over QUIC (DoQ)**：`quic://dns.adguard-dns.com` 或 `doq://9.9.9.9:853`

---

## 2. ECH (Encrypted Client Hello) 隐私防嗅探

在使用 DoH 或 HTTPS 向上游发起解析时，传统 TLS 握手会在明文中暴露 **SNI (服务器名称指示)**，使中间运营商或网络监听者仍能探知您的解析去向。

DNS Worker 原生集成 **RFC 9460 / RFC 8484 加密客户端 Hello (ECH)** 技术：
- 外发 DoH 请求会根据目标服务发布的 HTTPS/SVCB 记录自动加密内层 SNI。
- 开启后，中间网络观察者仅能看到用于伪装的公共前置域名（如 `cloudflare-ech.com`），无法获知真实的递归上游目标。

---

## 3. GeoIP 与 ECS 客户端子网智能分流

为防止 CDN 因递归代理而将国内或特定地区用户引导至异地边缘节点，DNS Worker 支持智能 EDNS Client Subnet (ECS) 转发：
- **子网精度裁剪**：仅向上游传递经过脱敏截断的 `/24` (IPv4) 或 `/48` (IPv6) 网段信息，在保留 CDN 就近调度能力的同时保护用户完整 IP 隐私。
- **区域智能分流**：根据 `IP_REGION` 列表对请求进行国内外判定，自动选择最优上游集群。

---

---

## 4. 网络配置差异对比：Serverless 与 Serverfull

由于 Cloudflare Workers 运行在边缘无服务器环境，而 Serverfull 模式直接监听宿主机操作系统网络堆栈，两者的配置参数存在显著架构差异：

| 网络参数 | Serverless (`wrangler.toml`) | Serverfull (`.env.serverfull`) | 架构差异与设计逻辑 |
| :--- | :--- | :--- | :--- |
| **监听网卡绑定** | 不适用（Cloudflare Anycast 托管） | `SERVERFULL_HOST=0.0.0.0` | Serverfull 需直接监听物理主机网卡接口。 |
| **UDP DNS 端口** | 边缘环境原生不支持直接监听 | `SERVERFULL_UDP_PORT=53` | Serverfull 绑定系统原生 UDP 53 端口。 |
| **DoT 监听端口** | 边缘环境原生不支持直接监听 | `SERVERFULL_DOT_PORT=853` | Serverfull 绑定系统原生 TLS 853 端口。 |
| **Web 仪表盘 / DoH (HTTP)** | 不适用 | `SERVERFULL_HTTP_PORT=10080` | 本地内网反向代理 / 面板 HTTP 端口。 |
| **Web 仪表盘 / DoH (HTTPS)** | 不适用（由 Cloudflare CDN 443 托管） | `SERVERFULL_HTTPS_PORT=10443` | 载入 TLS 证书后直连暴露的加密 HTTPS 端口。 |
| **DoT 对外基准域名** | 不适用 | `SERVERFULL_DOT_DOMAIN=dns.example.com` | Serverfull 用于 Android 私密 DNS 与 SNI 路由匹配。 |
| **ECH 混淆模式** | `PRESET_ECH_FRONTING_DOMAINS`（JSON 数组） | `SERVERFULL_ECH_ENABLED=true` | Serverfull 动态合成 RFC 9460 HTTPS/SVCB ECH 响应。 |
| **紧急兜底上游** | `FAIL_OPEN_UPSTREAM` | `FAIL_OPEN_UPSTREAM` | 两者一致（`https://freedns.controld.com/no-ads-malware-typo`）。 |

---

## 5. 网络环境变量参考手册

### 上游 DNS 变量

#### `FAIL_OPEN_UPSTREAM`
- **支持模式**：Serverless 与 Serverfull
- **默认值 (`wrangler.toml`)**：`https://freedns.controld.com/no-ads-malware-typo`
- **默认值 (`.env.serverfull`)**：`https://freedns.controld.com/no-ads-malware-typo`
- **说明**：当所有常规上游解析池超时或遭遇致命故障时的紧急回退解析器。支持 HTTPS (DoH)、DoT (`tls://`)、TCP (`tcp://`) 及 DNS Stamps (`sdns://`)。

#### `PRESET_UPSTREAMS`
- **支持模式**：Serverless 与 Serverfull
- **格式 (`wrangler.toml`)**：包含 `label` 与 `url` 对象的 JSON 数组 TOML 多行文本。
- **格式 (`.env.serverfull`)**：单行或多行 JSON 字符串。
- **默认值**：涵盖 Cloudflare Security、Quad9 ECS、AdGuard 以及 Google DNS 的高可用集群。

---

### ECH (Encrypted Client Hello) 变量

#### `PRESET_ECH_FRONTING_DOMAINS` *(仅 Serverless)*
- **类型**：JSON 字符串数组
- **默认值**：`["cloudflare-ech.com", "crypto.cloudflare.com", "one.one.one.one", "www.cloudflare.com", "encryptedsni.com", "cdnjs.com"]`
- **说明**：Cloudflare Worker 向外发起递归请求时用于伪装外层 SNI 的候选掩护域名池。

#### `SERVERFULL_ECH_ENABLED` 与 `SERVERFULL_ECH_FRONTING_DOMAIN` *(仅 Serverfull)*
- **类型**：`boolean` 与 `string`
- **默认值**：`SERVERFULL_ECH_ENABLED=true`，`SERVERFULL_ECH_FRONTING_DOMAIN=cloudflare-ech.com`
- **说明**：控制 Serverfull 守护进程是否在客户端查询 HTTPS/SVCB 及 DDR 时动态注入 ECHConfig 参数，并定义外层握手伪装域名。

---

### 服务监听与端口绑定变量 *(仅 Serverfull)*

#### `SERVERFULL_HOST`
- **默认值**：`0.0.0.0`
- **说明**：监听的本地 IP 接口。若配置 Nginx/Caddy 反向代理可设为 `127.0.0.1`。

#### `SERVERFULL_UDP_PORT`（或 `SERVERFULL_PORT`）
- **默认值**：`53`
- **说明**：RFC 1035 UDP DNS 端口。监听需 root 或 `CAP_NET_BIND_SERVICE` 权限。

#### `SERVERFULL_DOT_PORT`
- **默认值**：`853`
- **说明**：RFC 7858 DNS over TLS 监听端口。

#### `SERVERFULL_HTTP_PORT` 与 `SERVERFULL_HTTPS_PORT`
- **默认值**：`10080` (HTTP) 与 `10443` (HTTPS)
- **说明**：Web 控制台及 DoH 解析端口。当通过 `SERVERFULL_TLS_CERT_PATH` 与 `SERVERFULL_TLS_KEY_PATH` 载入证书后，HTTPS 端口自动启用。

#### `SERVERFULL_DOT_DOMAIN`
- **默认值**：`dns.example.com`
- **说明**：DoT 及安卓私密 DNS 基准域名。需配置通配符解析记录（`*.your.domain`）及对应的有效 TLS 证书。
