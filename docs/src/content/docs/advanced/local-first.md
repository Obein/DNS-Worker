---
title: 本地优先架构 (Local-First OPFS)
description: 浏览器端 WebAssembly SQLite + OPFS 零延迟分析技术解析。
---

传统 DNS 管理控制面板通常需要向云端数据库频繁发送 SQL 查询以获取日志和图表统计，这不仅带来了明显的网络延迟，还会快速消耗云数据库读写配额。

## 架构特性

* **嵌入式 SQLite (WASM + OPFS)**：
  控制台直接在浏览器后台 Web Worker 中运行纯 WebAssembly 编译的 SQLite 数据库，并持久化于原生的 Origin Private File System (OPFS)。
* **0ms 瞬间查询与图表聚合**：
  过滤数万条解析日志、切换图表维度（客户端 IP、响应码、拦截原因、目标国家）均在本地瞬间完成。
* **双向增量同步**：
  仅在初始化或检测到新日志时，通过增量光标向服务端拉取未同步密文并在本地解密插入，大幅节约网络流量与数据库计费。
