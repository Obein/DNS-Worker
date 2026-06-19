import React from "react";
import { Button, Navbar, Alignment, Icon } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Sun, Moon, Monitor, Settings } from "lucide-react";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import type { Profile } from "../types/auth";
import clsx from "clsx";

/**
 * Properties for the HeaderNavbar component.
 */
interface HeaderNavbarProps {
  /** Active UI theme. */
  theme: "light" | "dark" | "system";
  /** Callback to set active UI theme. */
  setTheme: (theme: "light" | "dark" | "system") => void;
  /** Currently selected Profile object. */
  selectedProfile: Profile | null;
  /** True if there is a selected/active profile. */
  isProfileActive: boolean;
  /** Router location object. */
  location: any;
  /** Router navigation function. */
  navigate: (path: string) => void;
}

/**
 * HeaderNavbar component renders the top sticky/blurred toolbar.
 *
 * @param props - Component props including active profiles, theme, and router functions.
 * @returns React elements representing the top navbar.
 */
export const HeaderNavbar: React.FC<HeaderNavbarProps> = ({
  theme,
  setTheme,
  selectedProfile,
  isProfileActive,
  location,
  navigate,
}) => {
  const { t } = useTranslation();

  return (
    <Navbar className="absolute! top-0 left-0 right-0 z-30 border-b! border-gray-200/50 dark:border-gray-800/50 shadow-none! bg-white/70! dark:bg-gray-900/70! backdrop-blur-lg! h-14 items-center px-4 shrink-0">
      <Navbar.Group align={Alignment.LEFT}>
        <button
          onClick={() => navigate("/dash")}
          className="font-bold text-blue-600 dark:text-blue-400 bg-transparent border-none p-0 cursor-pointer flex items-center gap-1"
        >
          <Icon icon="caret-left" />
          <span className="truncate max-w-30 md:max-w-none">
            {location.pathname === "/account"
              ? t("common.account")
              : isProfileActive
                ? selectedProfile?.name || t("common.loading")
                : t("common.selectProfile")}
          </span>
        </button>
        {isProfileActive && location.pathname !== "/account" && (
          <button
            onClick={() => {
              const profileId =
                selectedProfile?.id || location.pathname.split("/")[2];
              if (profileId) {
                navigate(`/dash/${profileId}/settings`);
              }
            }}
            className={clsx(
              "md:hidden ml-2 hover:text-gray-700  dark:hover:text-gray-200 bg-transparent border-none p-1 cursor-pointer flex items-center transition-colors",
              location.pathname.includes("/settings")
                ? "text-blue-500 dark:text-blue-400"
                : "text-gray-500 dark:text-gray-400",
            )}
            title={t("nav.settings")}
          >
            <Settings size={18} />
          </button>
        )}
      </Navbar.Group>
      <Navbar.Group align={Alignment.RIGHT}>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <div className="flex items-center gap-1 bg-gray-100/50 dark:bg-gray-800/50 p-1 rounded-lg">
            <Button
              variant="minimal"
              icon={<Sun size={14} />}
              size="small"
              active={theme === "light"}
              onClick={() => setTheme("light")}
            />
            <Button
              variant="minimal"
              icon={<Moon size={14} />}
              size="small"
              active={theme === "dark"}
              onClick={() => setTheme("dark")}
            />
            <Button
              variant="minimal"
              icon={<Monitor size={14} />}
              size="small"
              active={theme === "system"}
              onClick={() => setTheme("system")}
            />
          </div>
        </div>
      </Navbar.Group>
    </Navbar>
  );
};
