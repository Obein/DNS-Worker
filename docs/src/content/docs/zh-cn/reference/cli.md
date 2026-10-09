---
title: CLI 命令手册
description: dns-worker 命令行子命令与参数完整参考。
---

通过 `npm install -g dns-worker` 全局安装后，可在终端中直接使用以下命令：

## 主守护进程

```bash
dns-worker [options]
```

在前台直接启动服务。命令行参数拥有最高优先级，可覆盖 `.env` 配置：
- `-s, --status`：输出运行状态与数据库健康度检查
- `-f, --force, -y, --yes`：跳过重置命令的交互式二次确认
- `-p, --port, --http-port <number>`：HTTP 控制面板与 DoH 端口（默认：10080）
- `--https-port <number>`：HTTPS 控制面板与 DoH 端口（默认：10443）
- `--dns-port <number>`：传统 UDP DNS 端口（默认：53）
- `--dot-port <number>`：加密 DoT 端口（默认：853）
- `--dot-domain <domain>`：对外基准域名（如 `dns.example.com`）
- `-u, --user <username>`：服务运行系统用户

---

## 状态与诊断：`status`

```bash
dns-worker status
```

检查网络端口监听情况、TLS 证书有效性以及 SQLite 数据库连通性。

---

## 配置管理：`config`

```bash
# 查看当前激活的配置路径与已加载文件
dns-worker config show

# 输出当前正在生效的 .env 文件绝对路径
dns-worker config path

# 在标准配置目录生成干净的默认 .env 模板
dns-worker config init

# 输出内置的完整配置模板原始内容
dns-worker config template
```

---

## 恢复出厂重置：`reset`

```bash
# 交互式重置（包含二次确认防误触提示）
dns-worker reset

# 自动化/脚本强制重置（跳过确认提示）
dns-worker reset --force
# 或
dns-worker reset -y
```

将系统完全恢复至初始安装状态：
- **恢复默认配置**：将标准路径下的 `.env` 配置文件强制覆盖恢复为内置默认模板。
- **清空数据库**：安全清空并清理 SQLite 数据库文件（`*.sqlite`、`*-wal`、`*-shm`）。
- **重构全新架构**：从第 1 项迁移起重新完整执行所有数据库 Schema 迁移，生成立即可用的全新空白数据库。
- **二次防误触确认**：在终端交互环境下会要求输入 `yes` 二次确认，防止生产环境误操作导致数据丢失。

---

## 后台服务管理：`service`

```bash
# 安装系统服务 (可选 --user <username>)
sudo dns-worker service install [--user <username>]

# 控制服务启停与重启
sudo dns-worker service start
sudo dns-worker service stop
sudo dns-worker service restart

# 开启 / 关闭开机自启
sudo dns-worker service enable
sudo dns-worker service disable

# 实时状态与日志监控
sudo dns-worker service status
sudo dns-worker service logs

# 完全卸载系统服务
sudo dns-worker service uninstall
```
