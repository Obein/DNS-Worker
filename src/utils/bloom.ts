/**
 * BloomFilter.ts - 高性能布隆过滤器实现
 * 
 * 针对 P = 10^-6 精度场景进行高度优化。
 * 在该精度下，对于每个元素，k ≈ 20 (哈希函数数量)。
 * 优化重点：通过位运算替代算术运算、零拷贝反序列化、以及最小化 GC 压力的哈希路径。
 */
export class BloomFilter {
  private readonly size: number;
  private readonly hashes: number;
  private readonly bitArray: Uint8Array;

  private static readonly FNV_PRIME = 16777619;
  private static readonly FNV_SEED_0 = 2166136261;
  private static readonly FNV_SEED_1 = 3074159265;
  
  // 预分配 TextEncoder 以避免重复创建开销 (Isolate 全局)
  private static readonly encoder = new TextEncoder();

  /**
   * 构造函数
   * @param size 位数组长度 (bits)
   * @param hashes 哈希函数个数 (k)
   * @param bitArray 现有的二进制位数据
   */
  constructor(size: number, hashes: number, bitArray?: Uint8Array) {
    this.size = size >>> 0;
    this.hashes = hashes >>> 0;
    this.bitArray = bitArray || new Uint8Array((this.size + 7) >> 3);
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
    const data = BloomFilter.encoder.encode(element);
    const h1 = this.fnv1a(data, BloomFilter.FNV_SEED_0);
    const h2 = this.fnv1a(data, BloomFilter.FNV_SEED_1);

    for (let i = 0; i < this.hashes; i++) {
      // Double Hashing: (h1 + i * h2) % m
      // Fix: Avoid Math.imul which can return negative numbers and cause out-of-bounds indices
      const pos = (h1 + i * h2) % this.size;
      // 位运算优化: index / 8 => index >> 3, index % 8 => index & 7
      this.bitArray[pos >> 3] |= (1 << (pos & 7));
    }
  }

  /**
   * 检测元素是否存在 (无假阴性，有极低假阳性)
   * @param element 待检测字符串
   */
  test(element: string): boolean {
    const data = BloomFilter.encoder.encode(element);
    const h1 = this.fnv1a(data, BloomFilter.FNV_SEED_0);
    const h2 = this.fnv1a(data, BloomFilter.FNV_SEED_1);

    for (let i = 0; i < this.hashes; i++) {
      const pos = (h1 + i * h2) % this.size;
      if ((this.bitArray[pos >> 3] & (1 << (pos & 7))) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * 导出为原始二进制格式 (用于 R2 存储，避开 Base64 开销)
   * 结构: [4字节 size][4字节 hashes][位数组]
   */
  toUint8Array(): Uint8Array {
    const res = new Uint8Array(8 + this.bitArray.length);
    const view = new DataView(res.buffer);
    view.setUint32(0, this.size, true); // 小端序存储
    view.setUint32(4, this.hashes, true);
    res.set(this.bitArray, 8);
    return res;
  }

  /**
   * 从原始二进制流恢复 (零拷贝反序列化)
   */
  static fromUint8Array(buffer: Uint8Array): BloomFilter {
    const view = new DataView(buffer.buffer, buffer.byteOffset, 8);
    const size = view.getUint32(0, true);
    const hashes = view.getUint32(4, true);
    // 使用 subarray 保持对原始内存的引用，无额外拷贝
    const bitData = buffer.subarray(8);
    return new BloomFilter(size, hashes, bitData);
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
   * 传统 Base64 兼容导出逻辑
   */
  dump(): { size: number; hashes: number; data: string } {
    let binary = '';
    const len = this.bitArray.byteLength;
    const chunk = 0x8000;
    for (let i = 0; i < len; i += chunk) {
      binary += String.fromCharCode.apply(null, this.bitArray.subarray(i, Math.min(i + chunk, len)) as any);
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
    return new BloomFilter(dump.size, dump.hashes, bytes);
  }
}
