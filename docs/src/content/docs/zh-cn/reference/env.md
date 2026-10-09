---
title: 环境变量全参考
description: DNS Worker 独立模式与 Cloudflare 边缘模式的环境变量字典。
---

以下为独立模式 (`.env`) 与边缘模式支持的完整环境变量列表：

## 核心网络与端口配置

| 环境变量 | 说明 | 默认值 / 示例 |
|---|---|---|
| `SERVERFULL_HOST` | 监听主机地址 | `0.0.0.0` |
| `SERVERFULL_UDP_PORT` | 经典 UDP DNS 端口 | `53` |
| `SERVERFULL_DOT_PORT` | DoT 监听端口 | `853` |
| `SERVERFULL_HTTP_PORT` | HTTP Web 仪表板与 DoH 端口 | `10080` |
| `SERVERFULL_HTTPS_PORT` | HTTPS Web 仪表板与 DoH 端口 | `10443` |
| `SERVERFULL_DISABLE_HTTPS` | 是否禁用 HTTPS 服务 | `false` |
| `SERVERFULL_DISABLE_UDP` | 是否禁用 UDP DNS 服务 | `false` |
| `SERVERFULL_DISABLE_DOT` | 是否禁用 DoT 服务 | `false` |

---

## TLS 证书与加密配置

| 环境变量 | 说明 | 兼容别名 |
|---|---|---|
| `SERVERFULL_TLS_CERT_PATH` | TLS 证书链 PEM 路径 | `TLS_CERT_PATH`, `SSL_CERT_PATH`, `CERT_PATH` |
| `SERVERFULL_TLS_KEY_PATH` | TLS 私钥 PEM 路径 | `TLS_KEY_PATH`, `SSL_KEY_PATH`, `KEY_PATH` |
| `SERVERFULL_DOT_DOMAIN` | 基础域名（需通配符） | `DOT_DOMAIN`, `SERVERFULL_DOMAIN` |

---

## 认证与系统路径

| 环境变量 | 说明 | 默认值 / 示例 |
|---|---|---|
| `JWT_SECRET` | 会话与 API Token 签名密钥 | 自动生成高强度安全密钥 |
| `SERVERFULL_DB_PATH` | SQLite 数据库文件存储路径 | `/var/lib/dns-worker/dns_worker.sqlite` |
| `SERVERFULL_DEFAULT_PROFILE_KEY` | 默认回退 Profile Token | 自动匹配首个配置 |
| `KEK_v1` | 服务端凭据信封加密主密钥（可选） | 自定义安全字符串 |
