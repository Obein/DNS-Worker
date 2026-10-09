---
title: 架构与部署选型
description: 独立服务器模式与 Cloudflare Workers 边缘模式特性全面对比。
---

无论您是追求全球 300+ 城市的极速边缘调度与零运维，还是追求 100% 数据自主可控、家庭路由器直连经典 UDP 53 以及 Android 原生私有 DNS（DoT 853），DNS Worker 均能提供企业级过滤、本地优先瞬间分析以及基于后量子密码学的零知识端到端加密日志。

## 双引擎架构特性对比表

| 特性 / 维度 | 🖥️ 独立服务器 / VPS (脱离 Cloudflare) | ☁️ Cloudflare Workers 边缘模式 |
|---|---|---|
| **核心定位** | 100% 数据主权、家庭局域网/路由器直连、Android DoT | 全球极速边缘解析、免运维 Serverless |
| **运行平台** | Linux / VPS / macOS / Windows (`Node.js >= 22.5.0`，推荐 LTS) | Cloudflare 全球 300+ 城市边缘节点 |
| **存储介质** | 原生 Node.js SQLite (`node:sqlite`)，存储于本地 NVMe/SSD | Cloudflare D1（全球分布式云端数据库） |
| **支持协议** | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (RFC 8484) | **DoH** (RFC 8484 over HTTPS) |
| **数据主权** | **100% 自主可控**，完全无云厂商锁定 | 边缘加密；托管于 Cloudflare 基础设施 |
| **路由器 / 局域网接入** | **直接监听 UDP 53**（路由器 WAN/LAN DNS 直填服务器 IP） | 需搭配 DoH 客户端、代理或分流工具 |
| **Android 私有 DNS** | **原生 DoT 853**，支持 SNI 路由 (`<profile_key>.dns.example.com`) | 需通过 DoH URL 或第三方客户端支持 |
| **后量子零知识 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + 通行密钥 WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + 通行密钥 WebAuthn |
| **本地优先 Web UI** | ✅ 浏览器端 SQLite WASM + OPFS 0ms 瞬间查询 | ✅ 浏览器端 SQLite WASM + OPFS 0ms 瞬间查询 |
| **运维与维护** | 标准 systemd 常驻服务 (`dns-worker service install`) | 零服务器维护，边缘自适应伸缩 |
| **费用与门槛** | 运行于既有 VPS 或家用服务器硬件 | Cloudflare 免费套餐额度内免费运行 |

---

## 如何选择？

- **选择独立服务器模式 (Serverfull)**：
  - 您希望给家庭/办公室局域网路由器下发 DNS 地址（UDP 53）；
  - 您希望在 Android 手机“专用 DNS”中直接填入域名，享受原生的 DoT 853 加密；
  - 您追求 100% 数据私密性，不想将任何解析记录托付于第三方云厂商。
- **选择 Cloudflare Workers 模式**：
  - 您在全球多地频繁出差，追求无处不在的极低延迟；
  - 您不想维护任何 VPS 操作系统、安全补丁与磁盘空间。
