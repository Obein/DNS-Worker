import { deflateSync, inflateSync } from "node:zlib";

/**
 * D1 单行 / BLOB 存储切片大小（字节）
 * Cloudflare D1 单行/BLOB 的硬性上限为 2,000,000 字节 (~1.907 MB)。
 * 此处设定为 1.5 MB (1,572,864 字节)：
 * - 留有 ~417 KB 的安全缓冲，防范 SQLite 行大小边界溢出；
 * - 将默认 ~2.29 MB 的布隆过滤器切片数由 5 片降至 2 片，大幅缩减 D1 读写行数成本与 RPC 往返。
 */
export const BLOOM_CHUNK_SIZE = 1.5 * 1024 * 1024; // 1,572,864 bytes

/**
 * 压缩版布隆过滤器魔数：ASCII 'BLMZ' (0x5A4D4C42)
 * 用于在序列化二进制头部快速区分版本化压缩格式与传统未压缩格式。
 */
const BLMZ_MAGIC = 0x5a4d4c42;
const BLMZ_HEADER_SIZE = 20;

/**
 * BloomFilter.ts - 高性能布隆过滤器实现
 * 
 * 针对 P = 10^-6 精度场景进行高度优化。
 * 在该精度下，对于每个元素，k ≈ 20 (哈希函数数量)。
 * 优化重点：
 *   1. 使用 32位位数组 (Uint32Array) 代替 8位 (Uint8Array)，
 *      减少 4 倍的合并 (merge) 循环开销，以及加速位偏移计算。
 *   2. 利用 Kirsch-Mitzenmacher 优化，不再独立计算两个 FNV-1a，
 *      而是计算单个 FNV-1a 后，使用 MurmurHash3 的 fmix32 finalizer
 *      在 O(1) 复杂度内派生 h2。使域名遍历字符的循环开销直接减半！
 *   3. 缓存局部变量，使得 V8 编译器可以最大化做向量化 (SIMD) 优化。
 */
export class BloomFilter {
  private readonly size: number;
  private readonly hashes: number;
  private readonly bitArray: Uint32Array;

  private static readonly FNV_PRIME = 16777619;
  private static readonly FNV_SEED_0 = 2166136261;
  /** 预计算的 "||" (ASCII 124, 124) FNV-1a 流式哈希状态种子 */
  private static readonly FNV_SEED_PIPE_PIPE = 1431891397;
  
  // 预分配 TextEncoder 以避免重复创建开销 (Isolate 全局)
  private static readonly encoder = new TextEncoder();

  /**
   * 构造函数
   * @param size 位数组长度 (bits)
   * @param hashes 哈希函数个数 (k)
   * @param bitArray 现有的二进制位数据 (32位数组)
   */
  constructor(size: number, hashes: number, bitArray?: Uint32Array) {
    this.size = size >>> 0;
    this.hashes = hashes >>> 0;
    // 计算需要的 32位字 (words) 的数量
    const words = ((this.size + 31) >>> 5);
    this.bitArray = bitArray || new Uint32Array(words);
  }

  /**
   * 初始化布隆过滤器
   * @param expectedItems 预期存储的条目数 (n)
   * @param errorRate 假阳性率 (p)，默认 10^-4 (0.0001)
   */
  static create(expectedItems: number, errorRate: number = 0.0001): BloomFilter {
    const n = Math.max(expectedItems, 100);
    const p = errorRate;
    
    // 公式: m = -(n * ln(p)) / (ln(2)^2)
    const m = Math.ceil(-(n * Math.log(p)) / (Math.log(2) ** 2));
    // 公式: k = (m / n) * ln(2)
    const k = Math.round((m / n) * Math.log(2));
    
    return new BloomFilter(m, k);
  }

  /**
   * 添加元素
   * @param element 字符串元素
   */
  add(element: string): void {
    let h1 = BloomFilter.FNV_SEED_0;
    const len = element.length;
    for (let i = 0; i < len; i++) {
      h1 ^= element.charCodeAt(i) & 0xff;
      h1 = Math.imul(h1, BloomFilter.FNV_PRIME);
    }
    h1 = h1 >>> 0;
    
    // 用 MurmurHash3 fmix32 混淆算法根据 h1 快速派生 h2，减少一半的字符遍历和乘法开销
    let h2 = h1 ^ (h1 >>> 16);
    h2 = Math.imul(h2, 0x85ebca6b);
    h2 = h2 ^ (h2 >>> 13);
    h2 = Math.imul(h2, 0xc2b2ae35);
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;

    const arr = this.bitArray;
    const size = this.size;
    const k = this.hashes;

    for (let i = 0; i < k; i++) {
      // Double Hashing: (h1 + i * h2) % m
      const pos = (h1 + i * h2) % size;
      // 32位数组优化: index / 32 => pos >>> 5, index % 32 => pos & 31
      arr[pos >>> 5] |= (1 << (pos & 31));
    }
  }

  /**
   * 添加带有 "||" 前缀的域名元素（等价于 add(`||${domain}`)）。
   * 性能优化：直接使用预计算的 "||" FNV-1a 哈希种子继续流式哈希，
   * 彻底避免在 V8 堆内存中分配数万至数十万个新字符串模板！
   *
   * @param domain 纯域名字符串
   */
  addPipePipe(domain: string): void {
    let h1 = BloomFilter.FNV_SEED_PIPE_PIPE;
    const len = domain.length;
    for (let i = 0; i < len; i++) {
      h1 ^= domain.charCodeAt(i) & 0xff;
      h1 = Math.imul(h1, BloomFilter.FNV_PRIME);
    }
    h1 = h1 >>> 0;

    let h2 = h1 ^ (h1 >>> 16);
    h2 = Math.imul(h2, 0x85ebca6b);
    h2 = h2 ^ (h2 >>> 13);
    h2 = Math.imul(h2, 0xc2b2ae35);
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;

    const arr = this.bitArray;
    const size = this.size;
    const k = this.hashes;

    for (let i = 0; i < k; i++) {
      const pos = (h1 + i * h2) % size;
      arr[pos >>> 5] |= (1 << (pos & 31));
    }
  }

  /**
   * 检测元素是否存在 (无假阴性，有极低假阳性)
   * @param element 待检测字符串
   */
  test(element: string): boolean {
    let h1 = BloomFilter.FNV_SEED_0;
    const len = element.length;
    for (let i = 0; i < len; i++) {
      h1 ^= element.charCodeAt(i) & 0xff;
      h1 = Math.imul(h1, BloomFilter.FNV_PRIME);
    }
    h1 = h1 >>> 0;
    
    // 同理，在 O(1) 复杂度内派生 h2
    let h2 = h1 ^ (h1 >>> 16);
    h2 = Math.imul(h2, 0x85ebca6b);
    h2 = h2 ^ (h2 >>> 13);
    h2 = Math.imul(h2, 0xc2b2ae35);
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;

    const arr = this.bitArray;
    const size = this.size;
    const k = this.hashes;

    for (let i = 0; i < k; i++) {
      const pos = (h1 + i * h2) % size;
      if ((arr[pos >>> 5] & (1 << (pos & 31))) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * 获取布隆过滤器位长度 (bits)
   */
  getSize(): number {
    return this.size;
  }

  /**
   * 获取哈希函数数量 (k)
   */
  getHashes(): number {
    return this.hashes;
  }

  /**
   * 获取内部 32 位字数组
   */
  getBitArray(): Uint32Array {
    return this.bitArray;
  }

  /**
   * 导出为二进制格式。
   * 默认启用 Deflate 压缩（BLMZ 魔数封装），对于稀疏或常见订阅规则布隆过滤器，
   * 体积可缩减 70% ~ 99%，大幅减轻 D1 BLOB 存储行数与跨网络/缓存 I/O。
   *
   * @param compress 是否启用压缩，默认为 true；若设为 false 则输出传统未压缩格式
   */
  toUint8Array(compress: boolean = true): Uint8Array {
    if (!compress) {
      // 传统未压缩格式: [4字节 size][4字节 hashes][位数组]
      const res = new Uint8Array(8 + this.bitArray.byteLength);
      const view = new DataView(res.buffer);
      view.setUint32(0, this.size, true); // 小端序存储
      view.setUint32(4, this.hashes, true);
      res.set(new Uint8Array(this.bitArray.buffer, this.bitArray.byteOffset, this.bitArray.byteLength), 8);
      return res;
    }

    const rawBytes = new Uint8Array(this.bitArray.buffer, this.bitArray.byteOffset, this.bitArray.byteLength);
    let payload: Uint8Array;
    let isCompressed = false;

    try {
      const compressed = deflateSync(rawBytes);
      // 仅当压缩确实减小了体积时才启用压缩标志（防范极端高密度随机位反向膨胀）
      if (compressed.length < rawBytes.length) {
        payload = compressed;
        isCompressed = true;
      } else {
        payload = rawBytes;
      }
    } catch {
      payload = rawBytes;
    }

    const res = new Uint8Array(BLMZ_HEADER_SIZE + payload.length);
    const view = new DataView(res.buffer);
    view.setUint32(0, BLMZ_MAGIC, true);              // 4字节魔数 'BLMZ'
    view.setUint8(4, 1);                              // 1字节版本 (v1)
    view.setUint8(5, isCompressed ? 1 : 0);           // 1字节标志位 (bit 0: isCompressed)
    view.setUint16(6, 0, true);                       // 2字节保留字段 (对齐4字节边界)
    view.setUint32(8, this.size, true);               // 4字节 size (bits)
    view.setUint32(12, this.hashes, true);            // 4字节 hashes (k)
    view.setUint32(16, this.bitArray.length, true);   // 4字节 expected words count

    res.set(payload, BLMZ_HEADER_SIZE);
    return res;
  }

  /**
   * 从二进制流恢复布隆过滤器。
   * 具备全自动格式嗅探与向后兼容能力：
   * 1. 优先检测 BLMZ 压缩魔数头并即时快速解压；
   * 2. 若为旧版无魔数二进制（[4字节 size][4字节 hashes][位数组]），平滑回退至零拷贝反序列化。
   */
  static fromUint8Array(buffer: Uint8Array): BloomFilter {
    if (!buffer || buffer.byteLength < 8) {
      throw new Error("Invalid bloom filter buffer: header too short");
    }

    // 1. 嗅探是否为带有 BLMZ 魔数头的版本化/压缩格式
    if (buffer.byteLength >= BLMZ_HEADER_SIZE) {
      const view = new DataView(buffer.buffer, buffer.byteOffset, BLMZ_HEADER_SIZE);
      const magic = view.getUint32(0, true);

      if (magic === BLMZ_MAGIC) {
        const version = view.getUint8(4);
        if (version !== 1) {
          throw new Error(`Unsupported bloom filter version: ${version}`);
        }
        const flags = view.getUint8(5);
        const isCompressed = (flags & 1) !== 0;
        const size = view.getUint32(8, true);
        const hashes = view.getUint32(12, true);
        const expectedWords = view.getUint32(16, true);

        if (size === 0 || hashes === 0 || expectedWords === 0) {
          throw new Error("Invalid bloom filter parameters in BLMZ header");
        }

        const payload = buffer.subarray(BLMZ_HEADER_SIZE);
        let rawBytes: Uint8Array;

        if (isCompressed) {
          try {
            rawBytes = inflateSync(payload);
          } catch (e: any) {
            throw new Error(`Failed to decompress bloom filter payload: ${e.message || String(e)}`);
          }
        } else {
          rawBytes = payload;
        }

        const actualWords = rawBytes.byteLength >> 2;
        if (actualWords < expectedWords) {
          throw new Error(
            `Invalid bloom filter payload: bit array truncated (expected ${expectedWords} words, got ${actualWords})`
          );
        }

        let bitData: Uint32Array;
        if (rawBytes.byteOffset % 4 === 0) {
          bitData = new Uint32Array(rawBytes.buffer, rawBytes.byteOffset, expectedWords);
        } else {
          const copy = new Uint8Array(expectedWords << 2);
          copy.set(rawBytes.subarray(0, expectedWords << 2));
          bitData = new Uint32Array(copy.buffer, 0, expectedWords);
        }

        return new BloomFilter(size, hashes, bitData);
      }
    }

    // 2. 传统未压缩格式兼容回退: [4字节 size][4字节 hashes][位数组]
    const view = new DataView(buffer.buffer, buffer.byteOffset, 8);
    const size = view.getUint32(0, true);
    const hashes = view.getUint32(4, true);

    if (size === 0 || hashes === 0) {
      throw new Error("Invalid bloom filter parameters: size and hashes must be positive integers");
    }

    const offset = buffer.byteOffset + 8;
    const length = buffer.byteLength - 8;
    const expectedWords = (size + 31) >>> 5;
    const actualWords = length >> 2;

    if (actualWords < expectedWords) {
      throw new Error(
        `Invalid bloom filter buffer: bit array truncated (expected ${expectedWords} words, got ${actualWords})`
      );
    }

    let bitData: Uint32Array;
    // 确保 offset 是 4 的倍数，否则 Uint32Array 构建会抛出异常
    if (offset % 4 === 0) {
      bitData = new Uint32Array(buffer.buffer, offset, expectedWords);
    } else {
      // 非 4 字节对齐时，执行拷贝到对齐的 ArrayBuffer 内存中
      const copy = new Uint8Array(expectedWords << 2);
      copy.set(buffer.subarray(8, 8 + (expectedWords << 2)));
      bitData = new Uint32Array(copy.buffer, 0, expectedWords);
    }
    return new BloomFilter(size, hashes, bitData);
  }

  /**
   * 合并另一个布隆过滤器 (按位或运算)
   * 局部变量缓存以帮助 V8 引擎进行自动循环向量化 (SIMD) 优化
   */
  merge(other: BloomFilter): void {
    if (this.size !== other.size || this.hashes !== other.hashes) {
      throw new Error("Cannot merge bloom filters with different sizes or hash counts.");
    }
    const a = this.bitArray;
    const b = other.bitArray;
    const len = a.length;
    for (let i = 0; i < len; i++) {
      a[i] |= b[i];
    }
  }

  /**
   * 基础 FNV-1a 哈希实现，操作 Uint8Array 以获得最佳性能
   */
  private fnv1a(data: Uint8Array, seed: number): number {
    let hash = seed >>> 0;
    for (let i = 0; i < data.length; i++) {
      hash ^= data[i];
      hash = Math.imul(hash, BloomFilter.FNV_PRIME);
    }
    return hash >>> 0;
  }

  /**
   * 基础 FNV-1a 哈希实现，直接操作 string 字符以避免内存分配和 TextEncoder 性能开销
   */
  private fnv1aString(str: string, seed: number): number {
    let hash = seed >>> 0;
    const len = str.length;
    for (let i = 0; i < len; i++) {
      hash ^= str.charCodeAt(i) & 0xff;
      hash = Math.imul(hash, BloomFilter.FNV_PRIME);
    }
    return hash >>> 0;
  }

  /**
   * 传统 Base64 兼容导出逻辑
   */
  dump(): { size: number; hashes: number; data: string } {
    const bytes = new Uint8Array(this.bitArray.buffer, this.bitArray.byteOffset, this.bitArray.byteLength);
    let binary = '';
    const len = bytes.byteLength;
    const chunk = 0x8000;
    for (let i = 0; i < len; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, len)) as any);
    }
    return { size: this.size, hashes: this.hashes, data: btoa(binary) };
  }

  /**
   * 传统 Base64 兼容加载逻辑
   */
  static load(dump: { size: number; hashes: number; data: string }): BloomFilter {
    const binary = atob(dump.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    // 拷贝并填充到对齐的 Uint32Array 缓冲区
    const words = (bytes.length + 3) >> 2;
    const bitData = new Uint32Array(words);
    new Uint8Array(bitData.buffer).set(bytes);
    return new BloomFilter(dump.size, dump.hashes, bitData);
  }
}
