<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>隐私优先 Protective DNS 解析器 & DoH / DoT 服务端</p>
  <p>保护您的互联网第一跳</p>
  <p align="center">
    <a href="README.md">English</a> | 中文 (简体) | <a href="README_zh-TW.md">中文 (正體)</a>
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![npm: dns-worker](https://img.shields.io/npm/v/dns-worker.svg?logo=npm&color=CB3837)](https://www.npmjs.com/dns-worker)
[![Docker: hugokoo/dns-worker](https://img.shields.io/badge/docker-hugokoo%2Fdns--worker-2496ED.svg?logo=docker)](https://hub.docker.com/r/hugokoo/dns-worker)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js / Bun](https://img.shields.io/badge/Runtime-Node.js%20%7C%20Bun-green.svg)](https://nodejs.org/)
[![Database: D1 | Turso | File](https://img.shields.io/badge/Database-D1%20%7C%20Turso%20%7C%20File-blue.svg)](https://obein.github.io/DNS-Worker/deployment/database/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Docs: Astro Starlight](https://img.shields.io/badge/Docs-Astro%20Starlight-blueviolet.svg)](https://obein.github.io/DNS-Worker/)
[![Protocols: UDP 53 · DoT / DoQ · DoH (H2/H3)](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20%2F%20DoQ%20%7C%20DoH%20(H2%2FH3)-brightgreen.svg)](https://obein.github.io/DNS-Worker/deployment/matrix/)

</div>

---

## 📖 序

**DNS Worker** 是一套专为隐私、安全与性能而生的 Protective DNS 解析系统，原生支持广告与恶意域名拦截，采用独创的**双引擎架构**：

- **☁️ 边缘模式 (Serverless)**：运行在 Cloudflare 全球 300+ 城市边缘节点，配合 D1 数据库享受零运维的高可用 DoH 服务（全面兼容 HTTP/2 与 HTTP/3）。
- **🖥️ 独立服务器模式 (Serverfull)**：脱离 Cloudflare，运行在自有 VPS 或家庭服务器（Linux/Windows/macOS），原生支持经典 **UDP 53**、**DoT 853**（兼容 DoQ 并支持 TLS SNI 路由，原生适配 Android 私有 DNS）与本地 SQLite；
- **🗄️ 多数据库支持 (D1 / Turso / File)**：支持灵活配置底层存储。除默认的 Cloudflare D1 (Serverless) 和本地 SQLite 文件 (Serverfull) 外，更原生支持接入 **Turso**（分布式云原生 SQLite）。无论在边缘还是独立服务器，均可无缝切换至 Turso 数据库，彻底缓解 Cloudflare 原生 D1 免费层级（每天 500 万行读 / 10 万行写）配额不足的痛点，从容承载高频 DNS 日志写入。
- **🔀 多配置与多接入点支持**：灵活的策略隔离与设备分流体系。支持为家庭成员、不同网络环境或客户端创建多套相互隔离的配置（Profiles），每套配置可派生多个专用接入点（Access Points）并配发独立 Token，实现精细的设备级识别、定制上游、独立日志审计与个性化拦截规则。

> 📚 **用户文档**  
> 👉 [**https://obein.github.io/DNS-Worker/**](https://obein.github.io/DNS-Worker/)

### 快速上手

#### Cloudflare Workers 一键部署
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

#### 独立主机极速运行 (npm)
```bash
# 全局安装并启动
npm install -g dns-worker
dns-worker config init
dns-worker
# 访问控制台: http://localhost:10080
```

#### 容器化一键部署 (Docker / Bun LTS)
```bash
# 后台启动并直接映射 443 端口与 TLS 证书（建议通过 443 访问；满足证书时 80 端口自动重定向至 HTTPS）
docker run -d \
  --name dns-worker \
  --restart unless-stopped \
  -p 53:53/udp \
  -p 853:853/tcp \
  -p 80:80/tcp \
  -p 443:443/tcp \
  -v dns_worker_data:/var/lib/dns-worker \
  -v dns_worker_config:/etc/dns-worker \
  -v /etc/letsencrypt:/etc/ssl/dns-worker:ro \
  hugokoo/dns-worker:latest

# 访问控制台: https://your-domain-or-ip (配置证书后，80 端口自动跳转 HTTPS)
```

### 核心功能
- ⚡ **全栈协议**：UDP 53、DoT 853 (兼容 DoQ RFC 9250)、DoH (兼容 HTTP/2 与 HTTP/3)、ECH 与 DDR (RFC 9460)。
- 🔀 **多配置与多接入点支持**：支持按用户、家庭成员或使用场景建立多套独立配置（Profiles），每套配置可派生多个专用接入点（Access Points）并配发专属 Token，实现精准的设备级识别、策略隔离与独立统计。
- 🗄️ **多数据库自由切换**：支持 `D1`、`Turso`、`File` 多种数据库后端（通过 `DATABASE_SERVICE` 一键无缝切换），破解原生 D1 免费层用量限制。
- 🛡️ **后量子零知识 E2EE**：NIST FIPS 203 **P256-MLKEM768** 混合格密码学 + 硬件通行密钥（Passkey / WebAuthn）。
- 🚀 **本地优先 (Local-First)**：浏览器端 WebAssembly SQLite + OPFS，0ms 瞬间日志查询与统计分析。
- 🛡️ **精细防护与广告拦截**：广告与恶意域名拦截、域名通配过滤、百万级外部规则布隆过滤器秒级命中、自定义解析覆盖与 ECH 伪装。

---

## 🔎 预览

| 分析统计 | 解析目的地 |
|:---:|:---:|
| ![统计分析](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![解析目的地](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) |

| 多接入点与端点设置 | 规则设置 |
|:---:|:---:|
| ![多接入点](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-endpoints.webp) | ![规则设置](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) |

| 外部拦截列表 | 解析日志 |
|:---:|:---:|
| ![过滤列表](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) | ![解析日志](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) |

| 移动端统计 | 移动端日志 |
|:---:|:---:|
| ![移动端统计](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) | ![移动端日志](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_log.webp) |

> 💡 更多功能演示与端点设置，请部署后访问 Web 控制台或参阅 [官方文档](https://obein.github.io/DNS-Worker/)。

---

## 💪 动力

DNS Worker 的诞生与演进得益于现代开源生态的卓越基础设施与密码学成果：

- **计算与运行时**：[Node.js](https://nodejs.org/)（原生内置 `node:sqlite`）/ [Bun](https://bun.sh/) (>= 1.4.0) 与 [Cloudflare Workers](https://workers.cloudflare.com/) + [D1 Database](https://developers.cloudflare.com/d1/) / [Turso](https://turso.tech/) (libSQL)
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
