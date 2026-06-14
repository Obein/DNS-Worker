import React from "react";
import { Button, Intent, Popover } from "@blueprintjs/core";
import { LogOut, User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../../components/LanguageSwitcher";
import LogoIcon from "../../../assets/obex_cat_eye_logo-256.webp";

interface NavbarProps {
  isMobile: boolean;
  navigate: (path: string) => void;
  handleLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ isMobile, navigate, handleLogout }) => {
  const { t } = useTranslation();

  return (
    <div className="sticky top-0 z-30 h-14 border-b border-gray-200/50 dark:border-gray-800/50 bg-white/70 dark:bg-gray-900/70 backdrop-blur-lg flex items-center justify-between px-4 md:px-6 shrink-0">
      <div className="flex items-center gap-2">
        <img
          src={LogoIcon}
          alt="Obex DNS"
          className="w-8 h-8 object-contain"
        />
        <span className="font-bold text-lg tracking-tight dark:text-white">
          Obex DNS
        </span>
      </div>
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <div className="flex items-center gap-1">
          <Button
            variant="minimal"
            icon={<UserIcon size={18} />}
            text={isMobile ? "" : t("common.account")}
            onClick={() => navigate("/account")}
          />
          <Popover
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
          </Popover>
        </div>
      </div>
    </div>
  );
};
