/**
 * @file convert-tw.mjs
 * @description Automated converter from Simplified Chinese (zh-cn) to Traditional Chinese (zh-tw)
 * using opencc-js with Taiwan localization (twp).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OpenCC from 'opencc-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const docsRoot = path.resolve(__dirname, '..');
const srcDir = path.join(docsRoot, 'src', 'content', 'docs', 'zh-cn');
const targetDir = path.join(docsRoot, 'src', 'content', 'docs', 'zh-tw');

const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

/**
 * Converts text while preserving fenced code blocks, inline code, and URLs.
 */
function convertMarkdown(content) {
  // 1. Extract fenced code blocks
  const codeBlocks = [];
  let placeholderIndex = 0;
  const withoutCodeBlocks = content.replace(/(```[\s\S]*?```)/g, (match) => {
    const key = `@@@CODEBLOCK_${placeholderIndex++}@@@`;
    codeBlocks.push({ key, content: match });
    return key;
  });

  // 2. Extract inline code
  const inlineCodes = [];
  let inlineIndex = 0;
  const withoutInline = withoutCodeBlocks.replace(/(`[^`\n]+`)/g, (match) => {
    const key = `@@@INLINECODE_${inlineIndex++}@@@`;
    inlineCodes.push({ key, content: match });
    return key;
  });

  // 3. Extract markdown links to protect URL paths, only translating anchor text
  // format: [text](url)
  const links = [];
  let linkIndex = 0;
  const withoutLinks = withoutInline.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    const key = `@@@MDLINK_${linkIndex++}@@@`;
    // Replace zh-cn with zh-tw in internal docs links
    const convertedUrl = url.replace(/\/zh-cn\//g, '/zh-tw/');
    const convertedText = converter(text);
    links.push({ key, replacement: `[${convertedText}](${convertedUrl})` });
    return key;
  });

  // 4. Convert remaining prose text
  let converted = converter(withoutLinks);

  // 5. Restore markdown links
  for (const { key, replacement } of links) {
    converted = converted.replace(key, replacement);
  }

  // 6. Restore inline code
  for (const { key, content: inlineContent } of inlineCodes) {
    converted = converted.replace(key, inlineContent);
  }

  // 7. Restore fenced code blocks
  for (const { key, content: blockContent } of codeBlocks) {
    converted = converted.replace(key, blockContent);
  }

  return converted;
}

function processDirectory(source, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(source, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(source, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      processDirectory(srcPath, destPath);
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      const content = fs.readFileSync(srcPath, 'utf8');
      const convertedContent = convertMarkdown(content);
      fs.writeFileSync(destPath, convertedContent, 'utf8');
      console.log(`Converted: ${path.relative(docsRoot, destPath)}`);
    }
  }
}

console.log('>>> Starting Simplified to Traditional Chinese conversion...');
processDirectory(srcDir, targetDir);
console.log('>>> All zh-tw documents successfully converted!');
