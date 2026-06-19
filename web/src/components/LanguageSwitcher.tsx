import { useState } from "react";
import {
  Button,
  Menu,
  MenuItem,
  PopoverNext,
  Spinner,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { updateLocale } from "../utils/locale";

const LOCALE = [
  { label: "English", value: "en-US", flag: "🇺🇸" },
  { label: "English", value: "en-GB", flag: "🇬🇧" },
  { label: "English", value: "en-SG", flag: "🇸🇬" },
  { label: "简体中文", value: "zh-CN", flag: "🇨🇳" },
  { label: "简体中文", value: "zh-SG", flag: "🇸🇬" },
  { label: "正體中文", value: "zh-TW", flag: "🇹🇼" },
  { label: "繁體中文", value: "zh-HK", flag: "🇭🇰" },
  { label: "日本語", value: "ja-JP", flag: "🇯🇵" },
  { label: "한국어", value: "ko-KR", flag: "🇰🇷" },
  { label: "Tiếng Việt", value: "vi-VN", flag: "🇻🇳" },
  { label: "Español", value: "es-ES", flag: "🇪🇸" },
  { label: "Русский", value: "ru-RU", flag: "🇷🇺" },
  { label: "Français", value: "fr-FR", flag: "🇫🇷" },
  { label: "Deutsch", value: "de-DE", flag: "🇩🇪" },
];

export const LanguageSwitcher = ({
  minimal = true,
  size = "small",
}: {
  minimal?: boolean;
  size?: "small" | "regular";
}) => {
  const { i18n } = useTranslation();

  /** The locale currently being downloaded (null = idle). */
  const [loadingLocale, setLoadingLocale] = useState<string | null>(null);

  const currentLang =
    LOCALE.find((lang) => lang.value === i18n.language) || LOCALE[0];

  const handleLanguageChange = async (locale: string) => {
    if (locale === i18n.language || loadingLocale !== null) return;
    setLoadingLocale(locale);
    try {
      await updateLocale(locale);
    } finally {
      setLoadingLocale(null);
    }
  };

  const isLoading = loadingLocale !== null;

  return (
    <PopoverNext
      placement="bottom-start"
      disabled={isLoading}
      content={
        <Menu style={{ maxHeight: "300px", overflowY: "auto" }}>
          {LOCALE.map((lang) => (
            <MenuItem
              key={lang.value}
              text={lang.label + " [" + lang.flag + "]"}
              active={i18n.language === lang.value}
              disabled={isLoading}
              labelElement={
                loadingLocale === lang.value ? <Spinner size={12} /> : undefined
              }
              onClick={() => handleLanguageChange(lang.value)}
            />
          ))}
        </Menu>
      }
    >
      <Button
        variant={minimal ? "minimal" : undefined}
        size={size as any}
        icon={isLoading ? <Spinner size={14} /> : <Globe size={14} />}
      >
        <span className="hidden sm:inline ml-1">{currentLang.label}</span>
        <span className="inline sm:hidden ml-1">{currentLang.flag}</span>
      </Button>
    </PopoverNext>
  );
};
