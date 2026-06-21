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
import { LOCALE } from "../config/locales";

/**
 * LanguageSwitcher component provides a UI for users to switch application language.
 * It displays the current language and allows selection from available locales.
 *
 * @param props - Component props for minimal styling and button size.
 * @returns React element representing the language switcher button and menu.
 */
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
