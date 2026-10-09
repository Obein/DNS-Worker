---
title: 架构与部署选型
description: Cloudflare Workers 边缘模式 (首选推荐) 与独立服务器 Serverfull 模式全维度特性对比矩阵。
---

无论您看重全球 300+ 节点的零运维免托管与极速 Anycast 加速，还是追求 100% 数据主权并在局域网路由器通过 UDP 53 及 Android DoT 853 接入，DNS Worker 均提供亚毫秒级规则匹配、本地优先统计与后量子零知识加密审计日志。

## 双引擎特性对比矩阵

| 特性维度 | ☁️ Cloudflare Workers 边缘模式 (首选推荐) | 🖥️ 独立服务器 / VPS (Serverfull 自建可选) |
|---|---|---|
| **核心价值** | **全球极速 Anycast 边缘加速、免服务器运维** | 100% 数据自主、家庭局域网与路由器 UDP 53、安卓 DoT |
| **运行平台** | **Cloudflare 全球 300+ 边缘数据中心** | Linux / VPS / macOS / Windows (`Node.js >= 22.5.0`) |
| **存储后端** | **Cloudflare D1 (全球分布式 SQL 数据库)** | Node.js 原生内置 SQLite (`node:sqlite`) |
| **支持协议** | **DoH** (RFC 8484，支持 HTTP/2 与 HTTP/3) | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** |
| **运维成本** | **完全零服务器运维**，全球弹性自适应伸缩 | 需自行维护服务器操作系统、防火墙规则与常驻服务 |
| **路由器 / 内网接入** | 需前置 DoH 转发客户端（如 SmartDNS、OpenWrt、AdGuard Home） | **原生支持 UDP 53**（路由器 DNS 直接填写服务器 IP） |
| **安卓原生私密 DNS** | 需配合 DoH 模板或第三方 App | **原生支持 DoT 853**（支持 SNI 路由 `<token>.dns.example.com`） |
| **后量子零知识 E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **本地优先 Web 仪表盘** | ✅ 浏览器端 SQLite WASM + OPFS 0ms 闪电查询 | ✅ 浏览器端 SQLite WASM + OPFS 0ms 闪电查询 |
| **硬件与成本要求** | **完全适用 Cloudflare 免费套餐** | 基于自有 VPS、小主机或家庭 NAS 运行 |

---

## 我该如何选择？

### ☁️ 选择 Cloudflare Workers 边缘模式 (首选推荐)
- 追求**完全省心免维护**，无需为操作系统升级、进程挂掉或网络波动操心；
- 经常跨地域/跨国出行，需要全球 300+ 节点就近接入与极低解析延迟；
- 零硬件成本，完全基于 Cloudflare 免费配额即可稳定运行。

### 🖥️ 选择独立服务器 / VPS 模式 (Serverfull 自建方案)
- 需要为家庭局域网、智能电视或传统 IoT 路由器提供原生 UDP 53 无感拦截；
- 希望在 Android 系统设置中直接填入“私密 DNS”域名（853 端口）且不想安装第三方 App；
- 坚持将所有 DNS 查询历史与日志数据严格保存在自有 NVMe 物理硬盘中。
