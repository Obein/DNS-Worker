const fs = require('fs');
const path = require('path');

function processDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      processDir(fullPath);
    } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      let content = fs.readFileSync(fullPath, 'utf8');
      
      // Fix imports from types
      content = content.replace(/import\s+\{([^}]+)\}\s+from\s+"(\.\.?\/types)";/g, 'import type { $1 } from "$2";');
      
      // Specific fixes
      if (fullPath.includes('SetupView\\types.ts')) {
         content = content.replace('../../../config/regions', '../../config/regions');
      }
      if (fullPath.includes('SetupView\\index.tsx')) {
         content = content.replace(/area: t\("setup\.dynamicFromDomainV6", \{ domain \}\),/g, 'area: t("setup.dynamicFromDomainV6", { domain }) as string,');
         content = content.replace(/area: t\("setup\.dynamicFromDomain", \{ domain \}\),/g, 'area: t("setup.dynamicFromDomain", { domain }) as string,');
      }
      
      // qrcode.react
      content = content.replace(/import\s+\{([^}]+)\}\s+from\s+"qrcode\.react";/g, 'import type { $1 } from "qrcode.react";');
      
      // regions
      content = content.replace(/import\s+\{([^}]+)\}\s+from\s+"\.\.\/\.\.\/\.\.\/config\/regions";/g, 'import type { $1 } from "../../../config/regions";');

      fs.writeFileSync(fullPath, content);
    }
  }
}

processDir('d:/Coding/OriginalProject/ObexDNS/web/src/views');
console.log("Done");
