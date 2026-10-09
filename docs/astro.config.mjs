// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
  site: 'https://obein.github.io',
  base: '/DNS-Worker',
  vite: {
    cacheDir: './.vite-cache',
  },
  integrations: [
    starlight({
      title: 'DNS Worker',
      description: 'Privacy-First Protective DNS Resolver & DoH / DoT Server with Dual-Engine Architecture.',
      logo: {
        src: './src/assets/logo.webp',
      },
      favicon: '/favicon.ico',
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
          tag: 'link',
          attrs: {
            rel: 'icon',
            type: 'image/webp',
            href: '/DNS-Worker/favicon.webp'
          }
        },
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
            'zh-CN': '开始使用',
            'zh-cn': '开始使用',
            'zh-TW': '開始使用',
            'zh-tw': '開始使用',
          },
          items: [
            {
              label: 'Overview',
              translations: {
                'zh-CN': '项目概述',
                'zh-cn': '项目概述',
                'zh-TW': '專案概述',
                'zh-tw': '專案概述',
              },
              slug: 'guide/overview',
            },
            {
              label: 'Quick Start',
              translations: {
                'zh-CN': '快速上手',
                'zh-cn': '快速上手',
                'zh-TW': '快速上手',
                'zh-tw': '快速上手',
              },
              slug: 'guide/quickstart',
            },
          ],
        },
        {
          label: 'Deployment',
          translations: {
            'zh-CN': '部署指南',
            'zh-cn': '部署指南',
            'zh-TW': '部署指南',
            'zh-tw': '部署指南',
          },
          items: [
            {
              label: 'Architecture & Matrix',
              translations: {
                'zh-CN': '架构与部署选型',
                'zh-cn': '架构与部署选型',
                'zh-TW': '架構與部署選型',
                'zh-tw': '架構與部署選型',
              },
              slug: 'deployment/matrix',
            },
            {
              label: 'Cloudflare Workers Edge (Recommended)',
              translations: {
                'zh-CN': 'Cloudflare Workers 边缘模式 (首选推荐)',
                'zh-cn': 'Cloudflare Workers 边缘模式 (首选推荐)',
                'zh-TW': 'Cloudflare Workers 邊緣模式 (首選推薦)',
                'zh-tw': 'Cloudflare Workers 邊緣模式 (首選推薦)',
              },
              slug: 'deployment/cloudflare',
            },
            {
              label: 'Standalone Server / VPS',
              translations: {
                'zh-CN': '独立服务器 / VPS (Serverfull)',
                'zh-cn': '独立服务器 / VPS (Serverfull)',
                'zh-TW': '獨立伺服器 / VPS (Serverfull)',
                'zh-tw': '獨立伺服器 / VPS (Serverfull)',
              },
              slug: 'deployment/serverfull',
            },
            {
              label: 'Background Service Management',
              translations: {
                'zh-CN': '常驻后台服务管理',
                'zh-cn': '常驻后台服务管理',
                'zh-TW': '常駐背景服務管理',
                'zh-tw': '常駐背景服務管理',
              },
              slug: 'deployment/service',
            },
          ],
        },
        {
          label: 'Networking & Endpoints',
          translations: {
            'zh-CN': '网络与接入点',
            'zh-cn': '网络与接入点',
            'zh-TW': '網路與接入點',
            'zh-tw': '網路與接入點',
          },
          items: [
            {
              label: 'Endpoints & Client Setup',
              translations: {
                'zh-CN': '接入点配置与客户端设置',
                'zh-cn': '接入点配置与客户端设置',
                'zh-TW': '接入點配置與客戶端設定',
                'zh-tw': '接入點配置與客戶端設定',
              },
              slug: 'networking/endpoints',
            },
            {
              label: 'Upstreams & Network Architecture',
              translations: {
                'zh-CN': '上游解析与网络架构',
                'zh-cn': '上游解析与网络架构',
                'zh-TW': '上游解析與網路架構',
                'zh-tw': '上游解析與網路架構',
              },
              slug: 'networking/upstreams',
            },
          ],
        },
        {
          label: 'Domain Filtering & Rules',
          translations: {
            'zh-CN': '域名过滤与规则',
            'zh-cn': '域名过滤与规则',
            'zh-TW': '網域名稱過濾與規則',
            'zh-tw': '網域名稱過濾與規則',
          },
          items: [
            {
              label: 'Domain Filtering & Blocklists',
              translations: {
                'zh-CN': '域名过滤与规则引擎',
                'zh-cn': '域名过滤与规则引擎',
                'zh-TW': '網域名稱過濾與規則引擎',
                'zh-tw': '網域名稱過濾與規則引擎',
              },
              slug: 'filtering/rules',
            },
          ],
        },
        {
          label: 'Security & Advanced',
          translations: {
            'zh-CN': '进阶与安全',
            'zh-cn': '进阶与安全',
            'zh-TW': '進階與安全',
            'zh-tw': '進階與安全',
          },
          items: [
            {
              label: 'TLS Certificates & Permissions',
              translations: {
                'zh-CN': 'TLS 证书与权限最佳实践',
                'zh-cn': 'TLS 证书与权限最佳实践',
                'zh-TW': 'TLS 憑證與權限最佳實踐',
                'zh-tw': 'TLS 憑證與權限最佳實踐',
              },
              slug: 'advanced/tls-certs',
            },
            {
              label: 'Post-Quantum Zero-Knowledge E2EE',
              translations: {
                'zh-CN': '后量子零知识 E2EE',
                'zh-cn': '后量子零知识 E2EE',
                'zh-TW': '後量子零知識 E2EE',
                'zh-tw': '後量子零知識 E2EE',
              },
              slug: 'advanced/pqc-e2ee',
            },
            {
              label: 'Local-First Architecture (OPFS)',
              translations: {
                'zh-CN': '本地优先架构 (OPFS)',
                'zh-cn': '本地优先架构 (OPFS)',
                'zh-TW': '本地優先架構 (OPFS)',
                'zh-tw': '本地優先架構 (OPFS)',
              },
              slug: 'advanced/local-first',
            },
            {
              label: 'Authentication, Keys & KEK',
              translations: {
                'zh-CN': '身份认证、密钥体系与信封加密',
                'zh-cn': '身份认证、密钥体系与信封加密',
                'zh-TW': '身分認證、金鑰體系與信封加密',
                'zh-tw': '身分認證、金鑰體系與信封加密',
              },
              slug: 'advanced/security-auth',
            },
          ],
        },
        {
          label: 'Maintenance & Operations',
          translations: {
            'zh-CN': '维护与运维',
            'zh-cn': '维护与运维',
            'zh-TW': '維護與維運',
            'zh-tw': '維護與維運',
          },
          items: [
            {
              label: 'Retention, Maintenance & Lifecycle',
              translations: {
                'zh-CN': '数据留存、维护任务与生命周期',
                'zh-cn': '数据留存、维护任务与生命周期',
                'zh-TW': '資料留存、維護任務與生命週期',
                'zh-tw': '資料留存、維護任務與生命週期',
              },
              slug: 'maintenance/lifecycle',
            },
          ],
        },
        {
          label: 'Reference & FAQ',
          translations: {
            'zh-CN': '参考与排错',
            'zh-cn': '参考与排错',
            'zh-TW': '參考與排錯',
            'zh-tw': '參考與排錯',
          },
          items: [
            {
              label: 'CLI Reference',
              translations: {
                'zh-CN': 'CLI 命令手册',
                'zh-cn': 'CLI 命令手册',
                'zh-TW': 'CLI 指令手冊',
                'zh-tw': 'CLI 指令手冊',
              },
              slug: 'reference/cli',
            },
            {
              label: 'Troubleshooting & FAQ',
              translations: {
                'zh-CN': '常见问题与排错',
                'zh-cn': '常见问题与排错',
                'zh-TW': '常見問題與排錯',
                'zh-tw': '常見問題與排錯',
              },
              slug: 'faq/troubleshooting',
            },
          ],
        },
      ],
      customCss: [
        './src/styles/custom.css',
      ],
    }),
  ],
});
