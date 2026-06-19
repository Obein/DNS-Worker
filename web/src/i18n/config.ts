import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import enUS from './locales/en-US.json';

/**
 * Maps a resolved i18next language tag to its canonical locale key and the
 * dynamic import that delivers the corresponding JSON bundle.
 *
 * Only en-US is bundled statically (it acts as the fallback language).
 * Every other locale is split into its own async chunk by Rollup/Rolldown
 * and fetched on demand the first time that language is needed.
 */
const LOCALE_LOADERS: Record<string, () => Promise<Record<string, unknown>>> = {
  'zh-CN': () => import('./locales/zh-CN.json').then((m) => m.default),
  'zh-SG': () => import('./locales/zh-CN.json').then((m) => m.default),
  'zh-TW': () => import('./locales/zh-TW.json').then((m) => m.default),
  'zh-HK': () => import('./locales/zh-TW.json').then((m) => m.default),
  'ja-JP': () => import('./locales/ja-JP.json').then((m) => m.default),
  'ko-KR': () => import('./locales/ko-KR.json').then((m) => m.default),
  'fr-FR': () => import('./locales/fr-FR.json').then((m) => m.default),
  'de-DE': () => import('./locales/de-DE.json').then((m) => m.default),
  'es-ES': () => import('./locales/es-ES.json').then((m) => m.default),
  'ru-RU': () => import('./locales/ru-RU.json').then((m) => m.default),
  'vi-VN': () => import('./locales/vi-VN.json').then((m) => m.default),
};

/**
 * Load a locale bundle into the i18n instance if it has not been loaded yet.
 * Silently ignores unknown locale keys (falls back to en-US automatically).
 * Returns true if the locale was successfully loaded (or was already cached).
 */
export async function loadLocale(lang: string): Promise<boolean> {
  if (i18n.hasResourceBundle(lang, 'translation')) return true;

  const loader = LOCALE_LOADERS[lang];
  if (!loader) return false;

  try {
    const translations = await loader();
    i18n.addResourceBundle(lang, 'translation', translations, true, true);
    return true;
  } catch (err) {
    console.warn(`[i18n] Failed to load locale "${lang}":`, err);
    return false;
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Only en-US is bundled in the initial chunk; all other locales are lazy.
    resources: {
      'en-US': { translation: enUS },
      'en-GB': { translation: enUS },
      'en-SG': { translation: enUS },
    },
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false,
    },
  });

// Load the initially detected language as soon as possible.
loadLocale(i18n.language);

export default i18n;
