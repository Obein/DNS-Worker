---
title: 常駐後臺服務管理 (systemd & Windows)
description: 在 Linux systemd 與 Windows 計劃任務中以守護程序執行 DNS Worker。
---

DNS Worker 內建完善的服務生命週期管理器，可一鍵完成服務的註冊、配置、啟停與自啟。

## Linux systemd 服務

### 1. 服務安裝與註冊

```bash
# 默认以调用 sudo 的当前用户运行（推荐）
sudo dns-worker service install

# 或者指定以 root 或特定用户运行
sudo dns-worker service install --user root
```

:::tip[安全機制提示]
為遵循最小許可權原則，服務預設以非 root 使用者執行，並通過 Linux 核心特權 `CAP_NET_BIND_SERVICE` 繫結 53 與 853 埠。
:::

### 2. 常用管理命令

```bash
# 查看服务实时状态
sudo dns-worker service status

# 追踪服务实时运行日志 (journalctl)
sudo dns-worker service logs

# 重启服务
sudo dns-worker service restart

# 设置开机自启
sudo dns-worker service enable

# 取消开机自启
sudo dns-worker service disable

# 停止服务
sudo dns-worker service stop

# 彻底卸载服务
sudo dns-worker service uninstall
```

---

## Windows 計劃任務

在 Windows 環境下以管理員身份執行 PowerShell 或 CMD：

```powershell
# 安装计划任务并在系统启动时自启
dns-worker service install

# 查看任务状态
dns-worker service status

# 启停管理
dns-worker service start
dns-worker service stop
dns-worker service restart
```
