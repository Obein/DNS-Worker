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
          label: '简体中文',
          lang: 'zh-CN',
        },
        'zh-tw': {
          label: '正體中文',
          lang: 'zh-TW',
        },
        en: {
          label: 'English',
          lang: 'en',
        },
      },
      sidebar: [
        {
          label: '开始使用',
          translations: {
            'zh-tw': '開始使用',
            en: 'Getting Started',
          },
          items: [
            { label: '项目概述', translations: { 'zh-tw': '專案概述', en: 'Overview' }, slug: 'guide/overview' },
            { label: '快速上手', translations: { 'zh-tw': '快速上手', en: 'Quick Start' }, slug: 'guide/quickstart' },
          ],
        },
        {
          label: '部署指南',
          translations: {
            'zh-tw': '部署指南',
            en: 'Deployment',
          },
          items: [
            { label: '架构与部署选型', translations: { 'zh-tw': '架構與部署選型', en: 'Architecture & Matrix' }, slug: 'deployment/matrix' },
            { label: '独立服务器 / VPS', translations: { 'zh-tw': '獨立伺服器 / VPS', en: 'Standalone Server' }, slug: 'deployment/serverfull' },
            { label: 'Cloudflare Workers 边缘模式', translations: { 'zh-tw': 'Cloudflare Workers 邊緣模式', en: 'Cloudflare Workers' }, slug: 'deployment/cloudflare' },
            { label: '常驻后台服务管理', translations: { 'zh-tw': '常駐背景服務管理', en: 'Service Management' }, slug: 'deployment/service' },
          ],
        },
        {
          label: '进阶与安全',
          translations: {
            'zh-tw': '進階與安全',
            en: 'Advanced & Security',
          },
          items: [
            { label: 'TLS 证书与权限最佳实践', translations: { 'zh-tw': 'TLS 憑證與權限最佳實踐', en: 'TLS & Security' }, slug: 'advanced/tls-certs' },
            { label: '后量子零知识 E2EE', translations: { 'zh-tw': '後量子零知識 E2EE', en: 'Post-Quantum E2EE' }, slug: 'advanced/pqc-e2ee' },
            { label: '本地优先架构 (OPFS)', translations: { 'zh-tw': '本地優先架構 (OPFS)', en: 'Local-First' }, slug: 'advanced/local-first' },
          ],
        },
        {
          label: '参考与排错',
          translations: {
            'zh-tw': '參考與排錯',
            en: 'Reference & FAQ',
          },
          items: [
            { label: '环境变量字典', translations: { 'zh-tw': '環境變數辭典', en: 'Environment Variables' }, slug: 'reference/env' },
            { label: 'CLI 命令手册', translations: { 'zh-tw': 'CLI 指令手冊', en: 'CLI Commands' }, slug: 'reference/cli' },
            { label: '常见问题与排错', translations: { 'zh-tw': '常見問題與排錯', en: 'Troubleshooting' }, slug: 'faq/troubleshooting' },
          ],
        },
      ],
      customCss: [
        './src/styles/custom.css',
      ],
    }),
  ],
});
