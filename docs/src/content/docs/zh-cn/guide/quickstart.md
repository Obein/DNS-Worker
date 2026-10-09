---
title: 快速上手
description: 在 1 分钟内启动并体验 DNS Worker。
---

DNS Worker 提供极速上手的 CLI 工具，您无需繁琐的数据库配置即可在任何支持 Node.js 的环境快速启动。

## 环境要求
- **Node.js**：`>= 22.5.0`（推荐使用最新 LTS 版本，以使用原生内置 `node:sqlite`）
- **操作系统**：Linux、macOS 或 Windows

---

## 方式 1：全局安装快速运行（推荐）

```bash
# 1. 全局安装 CLI
npm install -g dns-worker

# 2. 初始化持久化目录与配置文件
dns-worker config init

# 3. 直接启动服务
dns-worker
```

启动后，访问控制台即可完成管理员账号初始化：
- **Web 控制台地址**：`http://localhost:10080`
- **默认 UDP DNS**：`127.0.0.1:53`

---

## 方式 2：使用 npx 免安装试用

```bash
npx dns-worker
```

---

## 方式 3：从源码仓库运行

```bash
# 1. 克隆代码仓库
git clone https://github.com/Obein/DNS-Worker.git
cd DNS-Worker

# 2. 安装项目依赖
npm install

# 3. 复制配置模板并启动
cp .env.serverfull .env
npm run start:serverfull
```

---

## 下一步

- [了解双引擎架构选型](/DNS-Worker/deployment/matrix/)
- [在 Linux / Windows 上配置开机自启常驻服务](/DNS-Worker/deployment/service/)
- [配置 TLS 证书开启 HTTPS 与 DoT](/DNS-Worker/advanced/tls-certs/)
