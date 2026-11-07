import fs from "fs";
import path from "path";

const localesDir = path.resolve(__dirname, "../web/src/i18n/locales");
const files = fs.readdirSync(localesDir).filter((f) => f.endsWith(".json"));

function getKeys(obj: any, prefix = ""): string[] {
  let keys: string[] = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (typeof obj[k] === "object" && obj[k] !== null && !Array.isArray(obj[k])) {
      keys = keys.concat(getKeys(obj[k], full));
    } else {
      keys.push(full);
    }
  }
  return keys.sort();
}

const baseKeys = getKeys(JSON.parse(fs.readFileSync(path.join(localesDir, "zh-CN.json"), "utf-8")));
console.log(`Base key count (zh-CN): ${baseKeys.length}`);

let allPassed = true;
for (const file of files) {
  const currentKeys = getKeys(JSON.parse(fs.readFileSync(path.join(localesDir, file), "utf-8")));
  const missing = baseKeys.filter((k) => !currentKeys.includes(k));
  const extra = currentKeys.filter((k) => !baseKeys.includes(k));

  if (missing.length > 0 || extra.length > 0) {
    allPassed = false;
    console.error(`[MISMATCH] ${file}: missing ${missing.length}, extra ${extra.length}`);
    if (missing.length) console.error("  Missing:", missing.slice(0, 5));
    if (extra.length) console.error("  Extra:", extra.slice(0, 5));
  } else {
    console.log(`[PASS] ${file}: exactly ${currentKeys.length} keys`);
  }
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log("All 10 locales are 100% in parity!");
}
