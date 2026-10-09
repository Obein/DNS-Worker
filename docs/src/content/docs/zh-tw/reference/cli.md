---
title: CLI 命令手册
description: dns-worker 命令行工具的指令与参数全参考。
---

全局安装 `npm install -g dns-worker` 后，可通过 `dns-worker` 执行以下命令：

## 主命令

```bash
dns-worker [options]
```

直接以前台进程运行 DNS Worker。支持传入命令行选项覆盖 `.env` 配置，例如：
- `-p, --port, --http-port <number>`：指定 HTTP 端口
- `--https-port <number>`：指定 HTTPS 端口
- `--dns-port <number>`：指定 UDP DNS 端口
- `--dot-port <number>`：指定 DoT 端口
- `--dot-domain <domain>`：指定对外基准域名

---

## 状态与诊断：`status`

```bash
dns-worker status
```

快速诊断服务运行时状态、端口监听情况、TLS 证书有效性及 SQLite 数据库连通性。

---

## 配置管理：`config`

```bash
# 查看当前加载的配置文件与持久化路径
dns-worker config show

# 输出当前配置文件的绝对路径
dns-worker config path

# 在标准路径生成 clean .env 模板
dns-worker config init

# 打印配置模板内容
dns-worker config template
```

---

## 后台服务管理：`service`

```bash
# 安装系统服务（可选 --user <username>）
sudo dns-worker service install [--user <username>]

# 启动 / 停止 / 重启服务
sudo dns-worker service start
sudo dns-worker service stop
sudo dns-worker service restart

# 启用 / 禁用开机自启
sudo dns-worker service enable
sudo dns-worker service disable

# 查看实时服务状态与日志
sudo dns-worker service status
sudo dns-worker service logs

# 卸载系统服务
sudo dns-worker service uninstall
```
