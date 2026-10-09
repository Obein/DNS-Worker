---
title: 本地優先架構 (Local-First OPFS)
description: 瀏覽器端 WebAssembly SQLite + OPFS 零延遲分析技術解析。
---

傳統 DNS 管理控制面板通常需要向雲端資料庫頻繁傳送 SQL 查詢以獲取日誌和圖表統計，這不僅帶來了明顯的網路延遲，還會快速消耗雲資料庫讀寫配額。

## 架構特性

* **嵌入式 SQLite (WASM + OPFS)**：
  控制台直接在瀏覽器後臺 Web Worker 中執行純 WebAssembly 編譯的 SQLite 資料庫，並持久化於原生的 Origin Private File System (OPFS)。
* **0ms 瞬間查詢與圖表聚合**：
  過濾數萬條解析日誌、切換圖表維度（客戶端 IP、響應碼、攔截原因、目標國家）均在本地瞬間完成。
* **雙向增量同步**：
  僅在初始化或檢測到新日誌時，通過增量游標向服務端拉取未同步密文並在本地解密插入，大幅節約網路流量與資料庫計費。
