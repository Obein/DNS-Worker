import { Button, Menu, MenuItem, PopoverNext } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { setSystemLocale } from "../utils/date";

const LOCALE = [
  { label: "English (🇺🇸)", value: "en-US", flag: "🇺🇸" },
  { label: "English (🇬🇧)", value: "en-GB", flag: "🇬🇧" },
  { label: "English (🇸🇬)", value: "en-SG", flag: "🇸🇬" },
  { label: "简体中文 (🇨🇳)", value: "zh-CN", flag: "🇨🇳" },
  { label: "简体中文 (🇸🇬)", value: "zh-SG", flag: "🇸🇬" },
  { label: "正體中文 (🇹🇼)", value: "zh-TW", flag: "🇹🇼" },
  { label: "繁體中文 (🇭🇰)", value: "zh-HK", flag: "🇭🇰" },
  { label: "日本語 (🇯🇵)", value: "ja-JP", flag: "🇯🇵" },
  { label: "한국어 (🇰🇷)", value: "ko-KR", flag: "🇰🇷" },
  { label: "Français (🇫🇷)", value: "fr-FR", flag: "🇫🇷" },
  { label: "Deutsch (🇩🇪)", value: "de-DE", flag: "🇩🇪" },
  { label: "Español (🇪🇸)", value: "es-ES", flag: "🇪🇸" },
];

export const LanguageSwitcher = ({
  minimal = true,
  size = "small",
}: {
  minimal?: boolean;
  size?: "small" | "regular";
}) => {
  const { i18n } = useTranslation();

  const currentLang = LOCALE.find((lang) => lang.value === i18n.language) || LOCALE[0];

  const handleLanguageChange = async (locale: string) => {
    i18n.changeLanguage(locale);
    setSystemLocale(locale);
    
    // Attempt to persist the language to user profile if logged in
    try {
      await fetch("/api/account/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
    } catch (e) {
      // Ignore if not logged in or backend unavailable
    }
  };

  return (
    <PopoverNext
      placement="bottom"
      content={
        <Menu style={{ maxHeight: "300px", overflowY: "auto" }}>
          {LOCALE.map((lang) => (
            <MenuItem
              key={lang.value}
              text={lang.label}
              active={i18n.language === lang.value}
              onClick={() => handleLanguageChange(lang.value)}
            />
          ))}
        </Menu>
      }
    >
      <Button
        variant={minimal ? "minimal" : undefined}
        size={size as any}
        icon={<Globe size={14} />}
      >
        <span className="hidden sm:inline ml-1">{currentLang.label}</span>
        <span className="inline sm:hidden ml-1">{currentLang.flag}</span>
      </Button>
    </PopoverNext>
  );
};
