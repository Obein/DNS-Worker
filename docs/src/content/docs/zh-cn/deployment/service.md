---
title: 常驻后台服务管理 (systemd & Windows)
description: 在 Linux systemd 与 Windows 计划任务中以守护进程运行 DNS Worker。
---

DNS Worker 内置完善的服务生命周期管理器，可一键完成服务的注册、配置、启停与自启。

## Linux systemd 服务

### 1. 服务安装与注册

```bash
# 默认以调用 sudo 的当前用户运行（推荐）
sudo dns-worker service install

# 或者指定以 root 或特定用户运行
sudo dns-worker service install --user root
```

:::tip[安全机制提示]
为遵循最小权限原则，服务默认以非 root 用户运行，并通过 Linux 内核特权 `CAP_NET_BIND_SERVICE` 绑定 53 与 853 端口。
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

## Windows 计划任务

在 Windows 环境下以管理员身份运行 PowerShell 或 CMD：

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
