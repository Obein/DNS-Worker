import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import zhCN from './locales/zh-CN.json';
import zhTW from './locales/zh-TW.json';
import enUS from './locales/en-US.json';
import jaJP from './locales/ja-JP.json';
import koKR from './locales/ko-KR.json';
import frFR from './locales/fr-FR.json';
import deDE from './locales/de-DE.json';
import esES from './locales/es-ES.json';
import ruRU from './locales/ru-RU.json';
import viVN from './locales/vi-VN.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      'en-US': { translation: enUS },
      'en-GB': { translation: enUS },
      'en-SG': { translation: enUS },
      'zh-CN': { translation: zhCN },
      'zh-SG': { translation: zhCN },
      'zh-TW': { translation: zhTW },
      'zh-HK': { translation: zhTW },
      'ja-JP': { translation: jaJP },
      'ko-KR': { translation: koKR },
      'fr-FR': { translation: frFR },
      'de-DE': { translation: deDE },
      'es-ES': { translation: esES },
      'ru-RU': { translation: ruRU },
      'vi-VN': { translation: viVN }
    },
    fallbackLng: 'en-US',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
