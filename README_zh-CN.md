<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>隐私优先 Protective DNS 解析器 & DoH / DoT 服务端</p>
  <p>保护您的互联网第一跳</p>
  <p align="center">
    <a href="README.md">English</a> | 中文 (简体) | <a href="README_zh-TW.md">中文 (正體)</a>
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js >= 22.5](https://img.shields.io/badge/Runtime-Node.js%20%3E%3D%2022.5%20(推荐%20LTS)-green.svg)](https://nodejs.org/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Docs: Astro Starlight](https://img.shields.io/badge/Docs-Astro%20Starlight-blueviolet.svg)](https://obein.github.io/DNS-Worker/)
[![Protocols: UDP 53 · DoT 853 · DoH](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20853%20%7C%20DoH-brightgreen.svg)](https://obein.github.io/DNS-Worker/deployment/matrix/)

</div>

---

## 📖 序言

**DNS Worker** 是一套专为隐私与性能而生的 Protective DNS 解析系统，采用独创的**双引擎架构**：
- **🖥️ 独立服务器模式 (Serverfull)**：脱离 Cloudflare，运行在自有 VPS 或家庭服务器（Linux/Windows/macOS），原生支持经典 **UDP 53**、**DoT 853**（TLS SNI 路由，原生适配 Android 私有 DNS）与本地 SQLite；
- **☁️ 边缘模式 (Serverless)**：运行在 Cloudflare 全球 300+ 城市边缘节点，配合 D1 数据库享受零运维的高可用 DoH 服务。

> 📚 **官方技术文档站点**  
> 详尽的部署指引、双引擎架构对比、TLS 证书与权限最佳实践、环境变量字典及常见排错，请参阅：  
> 👉 [**https://obein.github.io/DNS-Worker/**](https://obein.github.io/DNS-Worker/)

### 极速上手

#### 方式 A：独立主机极速运行 (npm)
```bash
# 全局安装并启动
npm install -g dns-worker
dns-worker config init
dns-worker
# 访问控制台: http://localhost:10080
```

#### 方式 B：Cloudflare Workers 一键部署
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

### 核心亮点
- ⚡ **全栈协议**：UDP 53、DoT 853、DoH (HTTP/2 & HTTP/3)、DoQ (RFC 9250)、ECH 与 DDR (RFC 9460)。
- 🛡️ **后量子零知识 E2EE**：NIST FIPS 203 **P256-MLKEM768** 混合格密码学 + 硬件通行密钥（Passkey / WebAuthn）。
- 🚀 **本地优先 (Local-First)**：浏览器端 WebAssembly SQLite + OPFS，0ms 瞬间日志查询与统计分析。
- 🛡️ **精细防护策略**：域名通配过滤、百万级外部规则布隆过滤器秒级命中、自定义解析覆盖与 ECH 伪装。

---

## 🖼️ 预览

| 分析统计 | 解析目的地 |
|:---:|:---:|
| ![统计分析](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![解析目的地](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) |

| 规则设置 | 外部拦截列表 |
|:---:|:---:|
| ![规则设置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) | ![过滤列表](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) |

| 解析日志 | 移动端适配 |
|:---:|:---:|
| ![解析日志](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) | ![移动端统计](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) |

> 💡 更多功能演示与端点设置，请部署后访问 Web 控制台或参阅 [官方文档](https://obein.github.io/DNS-Worker/)。

---

## 💪 动力

DNS Worker 的诞生与演进得益于现代开源生态的卓越基础设施与密码学成果：

- **计算与运行时**：[Node.js](https://nodejs.org/)（原生内置 `node:sqlite`）与 [Cloudflare Workers](https://workers.cloudflare.com/) + [D1 Database](https://developers.cloudflare.com/d1/)
- **用户界面**：[React](https://github.com/facebook/react)、[Blueprint](https://github.com/palantir/blueprint) 与 [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
- **文档体系**：[Astro](https://astro.build/) & [Starlight](https://starlight.astro.build/)（极速静态文档驱动）
- **密码学与数据存储**：[NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) (ML-KEM-768) 与 [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) (WASM + OPFS 本地优先驱动)

---

## 📄 开源协议

本项目采用 [AGPL-3.0](LICENSE) 开源许可证。

<div align="center">
  <br>
  <b>如果 DNS Worker 对您有所帮助，请考虑给它一个 ⭐</b>
</div>
