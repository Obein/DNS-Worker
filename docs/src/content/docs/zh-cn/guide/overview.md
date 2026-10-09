---
title: 项目概述
description: 了解 DNS Worker 的设计哲学、双引擎架构与核心能力。
---

## 什么是 DNS Worker？

**DNS Worker** 是一套专为现代隐私与防护而设计的 Protective DNS 解析系统，采用**双引擎架构（Dual-Engine Architecture）**：

1. **🖥️ 独立服务器模式 (Serverfull / Standalone)**：
   完全脱离 Cloudflare 基础设施，直接运行在您的自有 VPS、家用 Linux / Windows 服务器上。采用 Node.js 原生内置 `node:sqlite` 存储，原生监听经典 UDP 53、DoT 853 与 Web 面板 / DoH。
2. **☁️ 边缘模式 (Cloudflare Workers Serverless)**：
   免运维运行在 Cloudflare 全球 300+ 城市的分布式边缘节点，搭配分布式 D1 数据库，实现零服务器硬件成本与全球极速响应。

---

## 协议与核心能力

### 1. 全协议覆盖
* **经典 UDP 53 (RFC 1035)**：为路由器和内网设备提供即插即用的原生 DNS 解析。
* **DoT 853 (RFC 7858)**：基于 TLS 加密传输，原生适配 Android 9+“私有 DNS”，通过 TLS SNI 实现多配置自动路由（如 `<profileKey>.dns.example.com`）。
* **DoH (RFC 8484)**：支持 HTTP/2 与 HTTP/3 (Alt-Svc) 加密解析，兼容主流现代浏览器。
* **DoQ (RFC 9250)**：支持基于 QUIC 的 0-RTT 极速握手，无队头阻塞。
* **ECH 与 DDR (RFC 9460)**：广播 Encrypted Client Hello 参数与外层伪装 SNI，配合 DDR 实现加密 DNS 自动发现。

### 2. 本地优先 (Local-First) 架构
基于浏览器端原生 OPFS (Origin Private File System) 与 WebAssembly SQLite，用户端查询日志和聚合统计全部在本地 0ms 瞬间渲染，支持离线分析，后台自动执行轻量双向同步，大幅节省数据库计费与带宽。

### 3. 后量子零知识端到端加密 (E2EE)
引入 NIST FIPS 203 **P256-MLKEM768** 混合格密码学，配合硬件通行密钥（WebAuthn / Passkey）及恢复密钥。服务器只保存高强度加密密文，解密与私钥计算严格限定在用户的受信任设备内。
