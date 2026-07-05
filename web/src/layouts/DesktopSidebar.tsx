import React from "react";
import {
  Button,
  Menu,
  MenuItem,
  PopoverNext,
  Intent,
  Tag,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import {
  ListFilter,
  Settings,
  User as UserIcon,
  LogOut,
  Menu as MenuIcon,
} from "lucide-react";
import { clsx } from "clsx";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import type { UserInfo } from "../types/auth";

/**
 * Properties for the DesktopSidebar component.
 */
interface DesktopSidebarProps {
  /** True if sidebar is expanded. */
  isSidebarOpen: boolean;
  /** Callback to set expanded/collapsed state. */
  setIsSidebarOpen: (open: boolean) => void;
  /** True if there is a selected/active profile. */
  isProfileActive: boolean;
  /** Active profile ID, if any. */
  activeId: string | undefined;
  /** Router location object. */
  location: any;
  /** Router navigation function. */
  navigate: (path: string) => void;
  /** Callback to handle user logout action. */
  handleLogout: () => void;
  /** Current logged in user info. */
  currentUser: UserInfo | null;
  /** Main navigation menu items. */
  navItems: Array<{ id: string; label: string; icon: React.ReactNode; path: string }>;
}

/**
 * DesktopSidebar component renders the left navigation sidebar on desktop screens.
 *
 * @param props - Component props containing sidebar states, active profiles, and router hooks.
 * @returns React elements representing the desktop sidebar.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  isSidebarOpen,
  setIsSidebarOpen,
  isProfileActive,
  activeId,
  location,
  navigate,
  handleLogout,
  currentUser,
  navItems,
}) => {
  const { t } = useTranslation();

  return (
    <aside
      className={clsx(
        "flex flex-col border-r border-gray-200 dark:border-gray-800 transition-all duration-300 bg-white dark:bg-gray-900",
        isSidebarOpen ? "w-64" : "w-16",
      )}
    >
      <div className="h-14 flex items-center px-4 shrink-0">
        <img
          src={LogoIcon}
          alt="DNS Worker"
          className="w-8 h-8 object-contain shrink-0"
        />
        {isSidebarOpen && (
          <span className="ml-3 font-bold text-lg dark:text-white">
            DNS Worker
          </span>
        )}
      </div>
      <div className="flex-1 py-4 px-2 overflow-y-auto overflow-x-hidden">
        <Menu className="bg-transparent p-0">
          {navItems.map((item) => (
            <MenuItem
              key={item.id}
              icon={item.icon as any}
              text={isSidebarOpen ? item.label : ""}
              disabled={!isProfileActive}
              active={location.pathname.endsWith(
                item.id === "stats" ? "/stats" : `/${item.id}`,
              )}
              onClick={() => navigate(item.path)}
            />
          ))}
          <MenuItem
            icon={<ListFilter size={18} />}
            text={isSidebarOpen ? t("nav.filter") : ""}
            disabled={!isProfileActive}
            active={location.pathname.endsWith("/filter")}
            onClick={() => navigate(`/dash/${activeId}/filter`)}
          />
          <MenuItem
            icon={<Settings size={18} />}
            text={isSidebarOpen ? t("nav.settings") : ""}
            disabled={!isProfileActive}
            active={location.pathname.endsWith("/settings")}
            onClick={() => navigate(`/dash/${activeId}/settings`)}
          />
          <li className="my-4 border-t border-gray-100 dark:border-gray-800" />
          <MenuItem
            icon={<UserIcon size={18} />}
            text={isSidebarOpen ? t("common.account") : ""}
            active={location.pathname === "/account"}
            onClick={() => navigate("/account")}
          />
          <PopoverNext
            className="w-full"
            placement="right-end"
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
            <MenuItem
              icon={<LogOut size={18} />}
              text={isSidebarOpen ? t("common.logout") : ""}
              intent={Intent.DANGER}
              shouldDismissPopover={false}
            />
          </PopoverNext>
        </Menu>
      </div>
      <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <Button
          variant="minimal"
          icon={<MenuIcon size={18} />}
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        />
        {isSidebarOpen && (
          <Tag minimal round>
            {currentUser?.username.toUpperCase() || "USER"}
          </Tag>
        )}
      </div>
    </aside>
  );
};
