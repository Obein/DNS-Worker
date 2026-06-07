const fs = require('fs');

let c1 = fs.readFileSync('src/views/LogsView/components/LogsTable.tsx', 'utf8');
c1 = c1.replace('import { HTMLTable, Tag, Button } from "@blueprintjs/core";', 'import { HTMLTable, Tag } from "@blueprintjs/core";');
fs.writeFileSync('src/views/LogsView/components/LogsTable.tsx', c1);

let c2 = fs.readFileSync('src/views/SetupView/types.ts', 'utf8');
c2 = c2.replace('../../../config/regions', '../../config/regions');
fs.writeFileSync('src/views/SetupView/types.ts', c2);

let c3 = fs.readFileSync('src/views/SetupView/index.tsx', 'utf8');
c3 = c3.replace('area: t("setup.dynamicFromDomainV6", { domain }),', 'area: t("setup.dynamicFromDomainV6", { domain }) as string,');
c3 = c3.replace('area: t("setup.dynamicFromDomain", { domain }),', 'area: t("setup.dynamicFromDomain", { domain }) as string,');
fs.writeFileSync('src/views/SetupView/index.tsx', c3);

console.log("Fixed files");
