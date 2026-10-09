// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://obein.github.io',
  base: '/DNS-Worker',
  integrations: [
    starlight({
      title: 'DNS Worker',
      description: 'Privacy-First Protective DNS Resolver & DoH / DoT Server with Dual-Engine Architecture.',
      logo: {
        src: './src/assets/logo.webp',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Obein/DNS-Worker'
        }
      ],
      defaultLocale: 'root',
      locales: {
        root: {
          label: 'English',
          lang: 'en',
        },
        'zh-cn': {
          label: '简体中文',
          lang: 'zh-CN',
        },
        'zh-tw': {
          label: '正體中文',
          lang: 'zh-TW',
        },
      },
      head: [
        {
          tag: 'meta',
          attrs: {
            name: 'keywords',
            content: 'DNS, DoH, DoT, DoQ, ECH, RFC 8484, RFC 7858, RFC 9250, RFC 9460, Cloudflare Workers, Node.js, SQLite, NIST FIPS 203, ML-KEM-768, Post-Quantum Cryptography, AdBlock, Protective DNS, Android Private DNS'
          }
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:image',
            content: 'https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp'
          }
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:type',
            content: 'website'
          }
        },
        {
          tag: 'meta',
          attrs: {
            property: 'og:site_name',
            content: 'DNS Worker Documentation'
          }
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:card',
            content: 'summary_large_image'
          }
        },
        {
          tag: 'meta',
          attrs: {
            name: 'twitter:image',
            content: 'https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp'
          }
        },
        {
          tag: 'meta',
          attrs: {
            name: 'theme-color',
            content: '#3b82f6'
          }
        },
        {
          tag: 'script',
          attrs: {
            type: 'application/ld+json'
          },
          content: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'DNS Worker',
            operatingSystem: 'Linux, Windows, macOS, Cloudflare Workers',
            applicationCategory: 'NetworkingApplication',
            description: 'Privacy-First Protective DNS Resolver & DoH / DoT Server with Dual-Engine Architecture.',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD'
            }
          })
        }
      ],
      sidebar: [
        {
          label: 'Getting Started',
          translations: {
            'zh-cn': '开始使用',
            'zh-tw': '開始使用',
          },
          items: [
            { label: 'Overview', translations: { 'zh-cn': '项目概述', 'zh-tw': '專案概述' }, slug: 'guide/overview' },
            { label: 'Quick Start', translations: { 'zh-cn': '快速上手', 'zh-tw': '快速上手' }, slug: 'guide/quickstart' },
          ],
        },
        {
          label: 'Deployment',
          translations: {
            'zh-cn': '部署指南',
            'zh-tw': '部署指南',
          },
          items: [
            { label: 'Architecture & Matrix', translations: { 'zh-cn': '架构与部署选型', 'zh-tw': '架構與部署選型' }, slug: 'deployment/matrix' },
            { label: 'Standalone Server / VPS', translations: { 'zh-cn': '独立服务器 / VPS', 'zh-tw': '獨立伺服器 / VPS' }, slug: 'deployment/serverfull' },
            { label: 'Cloudflare Workers Edge', translations: { 'zh-cn': 'Cloudflare Workers 边缘模式', 'zh-tw': 'Cloudflare Workers 邊緣模式' }, slug: 'deployment/cloudflare' },
            { label: 'Background Service Management', translations: { 'zh-cn': '常驻后台服务管理', 'zh-tw': '常駐背景服務管理' }, slug: 'deployment/service' },
          ],
        },
        {
          label: 'Security & Advanced',
          translations: {
            'zh-cn': '进阶与安全',
            'zh-tw': '進階與安全',
          },
          items: [
            { label: 'TLS Certificates & Permissions', translations: { 'zh-cn': 'TLS 证书与权限最佳实践', 'zh-tw': 'TLS 憑證與權限最佳實踐' }, slug: 'advanced/tls-certs' },
            { label: 'Post-Quantum Zero-Knowledge E2EE', translations: { 'zh-cn': '后量子零知识 E2EE', 'zh-tw': '後量子零知識 E2EE' }, slug: 'advanced/pqc-e2ee' },
            { label: 'Local-First Architecture (OPFS)', translations: { 'zh-cn': '本地优先架构 (OPFS)', 'zh-tw': '本地優先架構 (OPFS)' }, slug: 'advanced/local-first' },
          ],
        },
        {
          label: 'Reference & FAQ',
          translations: {
            'zh-cn': '参考与排错',
            'zh-tw': '參考與排錯',
          },
          items: [
            { label: 'Environment Variables', translations: { 'zh-cn': '环境变量字典', 'zh-tw': '環境變數辭典' }, slug: 'reference/env' },
            { label: 'CLI Reference', translations: { 'zh-cn': 'CLI 命令手册', 'zh-tw': 'CLI 指令手冊' }, slug: 'reference/cli' },
            { label: 'Troubleshooting & FAQ', translations: { 'zh-cn': '常见问题与排错', 'zh-tw': '常見問題與排錯' }, slug: 'faq/troubleshooting' },
          ],
        },
      ],
      customCss: [
        './src/styles/custom.css',
      ],
    }),
  ],
});
