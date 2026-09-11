import React from "react";
import { Button, Intent, PopoverNext } from "@blueprintjs/core";
import { LogOut, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";
import { SessionLockButton } from "../../../components/SessionLockButton";
import type { UserInfo } from "../../../types/auth";
import LogoIcon from "../../../assets/obex_cat_eye_logo-256.webp";

/**
 * Properties for the Navbar component on the dashboard home (select profile) page.
 */
interface NavbarProps {
  isMobile: boolean;
  navigate: (path: string) => void;
  handleLogout: () => void;
  currentUser?: UserInfo | null;
}

/**
 * Navbar component for the profile selection view.
 * Displays brand logo, application name, current domain, language switcher, and account actions.
 */
export const Navbar: React.FC<NavbarProps> = ({ isMobile, navigate, handleLogout, currentUser }) => {
  const { t } = useTranslation();
  const currentDomain =
    typeof window !== "undefined"
      ? window.location.host || window.location.hostname
      : "";

  return (
    <div
      className="sticky top-0 z-30 h-14 border-b border-gray-200/50 dark:border-gray-800/50 bg-white/70 dark:bg-gray-900/70 backdrop-blur-lg flex items-center justify-between px-4 md:px-6 shrink-0"
      style={{ transform: "translateZ(0)" }}
    >
      <div className="flex items-center gap-2.5">
        <img
          src={LogoIcon}
          alt="DNS Worker"
          className="w-8 h-8 object-contain shrink-0"
        />
        <div className="flex flex-col justify-center">
          <span className="font-bold text-base leading-tight tracking-tight dark:text-white">
            DNS Worker
          </span>
          {currentDomain && (
            <span
              className="text-xs text-gray-500 dark:text-gray-400 font-mono leading-tight mt-0.5 select-all"
              title={currentDomain}
            >
              {currentDomain}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <SessionLockButton currentUser={currentUser} />
        <LanguageSwitcher />
        <div className="flex items-center gap-1">
          <Button
            variant="minimal"
            icon={<UserIcon size={18} />}
            text={isMobile ? "" : t("common.account")}
            onClick={() => navigate("/account")}
          />
          <PopoverNext
            content={
              <div className="p-4 space-y-3">
                <div className="font-bold text-sm">
                  {t("common.confirmLogout")}
                </div>
                <Button
                  fill
                  intent={Intent.DANGER}
                  text={t("common.logout")}
                  onClick={handleLogout}
                />
              </div>
            }
          >
            <Button
              variant="minimal"
              intent={Intent.DANGER}
              icon={<LogOut size={18} />}
              text={isMobile ? "" : t("common.logout")}
            />
          </PopoverNext>
        </div>
      </div>
    </div>
  );
};
