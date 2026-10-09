---
title: CLI 命令手冊
description: dns-worker 命令列工具的指令與引數全參考。
---

全域性安裝 `npm install -g dns-worker` 後，可通過 `dns-worker` 執行以下命令：

## 主命令

```bash
dns-worker [options]
```

直接以前臺程序執行 DNS Worker。支援傳入命令列選項覆蓋 `.env` 配置，例如：
- `-p, --port, --http-port <number>`：指定 HTTP 埠
- `--https-port <number>`：指定 HTTPS 埠
- `--dns-port <number>`：指定 UDP DNS 埠
- `--dot-port <number>`：指定 DoT 埠
- `--dot-domain <domain>`：指定對外基準域名

---

## 狀態與診斷：`status`

```bash
dns-worker status
```

快速診斷服務執行時狀態、埠監聽情況、TLS 證書有效性及 SQLite 資料庫連通性。

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

## 後臺服務管理：`service`

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
