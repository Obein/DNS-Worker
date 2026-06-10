import React from "react";
import { User as UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clsx } from "clsx";

/**
 * Properties for the MobileBottomNav component.
 */
interface MobileBottomNavProps {
  /** True if there is a selected/active profile. */
  isProfileActive: boolean;
  /** Main navigation menu items. */
  navItems: Array<{ id: string; label: string; icon: React.ReactNode; path: string }>;
  /** Router location object. */
  location: any;
  /** Router navigation function. */
  navigate: (path: string) => void;
}

/**
 * MobileBottomNav component renders the bottom sticky tab bar on mobile screens.
 *
 * @param props - Component props containing active profile conditions and router hooks.
 * @returns React elements representing the mobile bottom navigation bar.
 */
export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  isProfileActive,
  navItems,
  location,
  navigate,
}) => {
  const { t } = useTranslation();

  if (!isProfileActive) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-16 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border-t border-gray-200/50 dark:border-gray-800/50 flex items-center justify-around px-2 z-50 pb-safe">
      {navItems.map((item) => {
        const isActive = location.pathname.includes(
          item.id === "stats" ? "/stats" : `/${item.id}`,
        );
        return (
          <button
            key={item.id}
            onClick={() => navigate(item.path)}
            className={clsx(
              "flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors",
              isActive ? "text-blue-500" : "text-gray-400",
            )}
          >
            {item.icon}
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
      <button
        onClick={() => navigate("/account")}
        className={clsx(
          "flex flex-col items-center justify-center gap-1 w-16 h-full transition-colors",
          location.pathname === "/account"
            ? "text-blue-500"
            : "text-gray-400",
        )}
      >
        <UserIcon size={20} />
        <span className="text-[10px] font-medium">
          {t("common.account")}
        </span>
      </button>
    </div>
  );
};
