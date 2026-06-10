/**
 * Encodes string record values (like IPs, domains, texts) into standard DNS RDATA byte segments.
 *
 * @param type - The DNS record type.
 * @param value - The payload value to encode.
 * @returns A number array representing encoded RDATA bytes.
 */
export function encodeRData(type: string, value: string): number[] {
  let data: number[] = [];
  if (type === "A") {
    data = value.split(".").map((v) => parseInt(v) || 0);
  } else if (type === "AAAA") {
    const bytes = new Uint8Array(16).fill(0);
    if (value.includes("::")) {
      const [left, right] = value.split("::");
      const leftParts = left.split(":").filter((p) => p);
      const rightParts = right.split(":").filter((p) => p);

      let i = 0;
      for (const part of leftParts) {
        const v = parseInt(part, 16);
        bytes[i++] = (v >> 8) & 0xff;
        bytes[i++] = v & 0xff;
      }

      i = 16 - rightParts.length * 2;
      for (const part of rightParts) {
        const v = parseInt(part, 16);
        bytes[i++] = (v >> 8) & 0xff;
        bytes[i++] = v & 0xff;
      }
    } else {
      const parts = value.split(":");
      let i = 0;
      for (const part of parts) {
        const v = parseInt(part, 16);
        bytes[i++] = (v >> 8) & 0xff;
        bytes[i++] = v & 0xff;
      }
    }
    data = Array.from(bytes);
  } else if (type === "CNAME") {
    const labels = value.split(".");
    for (const label of labels) {
      data.push(label.length);
      for (let i = 0; i < label.length; i++) data.push(label.charCodeAt(i));
    }
    data.push(0);
  } else if (type === "TXT") {
    for (let i = 0; i < value.length; i += 255) {
      const chunk = value.substring(i, i + 255);
      data.push(chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        data.push(chunk.charCodeAt(j));
      }
    }
  }
  return data;
}
