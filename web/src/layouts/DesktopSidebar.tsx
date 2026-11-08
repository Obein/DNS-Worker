import React, { useEffect } from "react";
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
  Server,
  X,
} from "lucide-react";
import { clsx } from "clsx";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import type { UserInfo } from "../types/auth";
import { useUpstreamUpdate } from "../hooks/useUpstreamUpdate";

/**
 * Properties for the DesktopSidebar component.
 */
interface DesktopSidebarProps {
  /** True if sidebar is expanded. */
  isSidebarOpen: boolean;
  /** Callback to set expanded/collapsed state. */
  setIsSidebarOpen: (open: boolean) => void;
  /** True if active screen viewport is mobile. */
  isMobile?: boolean;
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
 * DesktopSidebar component renders the navigation sidebar on desktop and mobile screens.
 * On mobile, it acts as an off-canvas slide-out drawer that defaults to completely collapsed.
 *
 * @param props - Component props containing sidebar states, active profiles, and router hooks.
 * @returns React elements representing the sidebar and mobile backdrop.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  isSidebarOpen,
  setIsSidebarOpen,
  isMobile = false,
  isProfileActive,
  activeId,
  location,
  navigate,
  handleLogout,
  currentUser,
  navItems,
}) => {
  const { t } = useTranslation();
  const { hasUpdate, latestTag, appVersion, gitTag, gitCommit } = useUpstreamUpdate();

  // Swipe-to-close handling on mobile
  const touchStartRef = React.useRef<{ x: number; y: number; time: number } | null>(null);
  const [dragOffset, setDragOffset] = React.useState<number | null>(null);

  useEffect(() => {
    if (!isSidebarOpen) {
      setDragOffset(null);
      touchStartRef.current = null;
    }
  }, [isSidebarOpen]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isMobile || !isSidebarOpen) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isMobile || !isSidebarOpen || !touchStartRef.current) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    // Track horizontal swipe left (diffX < 0)
    if (diffX < 0 && Math.abs(diffX) > Math.abs(diffY)) {
      setDragOffset(Math.min(0, diffX));
    }
  };

  const handleTouchEnd = () => {
    if (!touchStartRef.current) return;
    const duration = Date.now() - touchStartRef.current.time;
    const offset = dragOffset ?? 0;

    // Swipe left to close: drag left > 50px or quick flick left > 20px
    if (offset < -50 || (duration < 300 && offset < -20)) {
      setIsSidebarOpen(false);
    }
    setDragOffset(null);
    touchStartRef.current = null;
  };

  const handleTouchCancel = () => {
    setDragOffset(null);
    touchStartRef.current = null;
  };

  // On mobile, automatically close drawer on Escape key press
  useEffect(() => {
    if (!isMobile || !isSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isMobile, isSidebarOpen, setIsSidebarOpen]);

  const showText = isMobile ? true : isSidebarOpen;

  const handleNavClick = (path: string) => {
    navigate(path);
    if (isMobile) {
      setIsSidebarOpen(false);
    }
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isMobile && isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-xs z-40 transition-opacity md:hidden!"
          onClick={() => setIsSidebarOpen(false)}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
          style={
            dragOffset !== null
              ? {
                  opacity: Math.max(0, 1 - Math.abs(dragOffset) / 256),
                  transition: "none",
                }
              : undefined
          }
          aria-hidden="true"
        />
      )}

      <aside
        className={clsx(
          "flex flex-col border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900",
          isMobile
            ? clsx(
                "fixed inset-y-0 left-0 z-50 w-64 shadow-2xl transform select-none",
                isSidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
              )
            : clsx(
                "relative z-20 shrink-0",
                isSidebarOpen ? "w-64" : "w-16"
              ),
          dragOffset === null && "transition-all duration-300"
        )}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        style={
          isMobile && isSidebarOpen && dragOffset !== null
            ? {
                transform: `translateX(${dragOffset}px)`,
                transition: "none",
              }
            : undefined
        }
      >
        <div className="h-14 flex items-center pl-3.5 pr-2 shrink-0 justify-between">
          <div className="flex items-center min-w-0">
            <img
              src={LogoIcon}
              alt="DNS Worker"
              className="w-8 h-8 object-contain shrink-0"
            />
            {showText && (
              <div className="ml-2.5 flex flex-col justify-center min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 min-w-0">
                  <span className="font-bold text-base leading-tight dark:text-white shrink-0">
                    DNS Worker
                  </span>
                  <span
                    className="text-xs text-gray-500 dark:text-gray-400 font-mono leading-tight truncate shrink-0 inline-flex items-center"
                    title={hasUpdate ? (latestTag ? `New version available: ${latestTag}` : "Update available") : appVersion}
                  >
                    {hasUpdate ? (
                      <a
                        href="https://github.com/Obein/DNS-Worker/releases"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-amber-500 dark:text-amber-400 hover:underline transition-colors"
                      >
                        {gitTag}
                      </a>
                    ) : (
                      <span>{gitTag}</span>
                    )}
                    {gitCommit ? `-${gitCommit}` : ""}
                  </span>
                </div>
                <span
                  className="text-xs text-gray-500 dark:text-gray-400 font-mono leading-tight mt-0.5 truncate select-all"
                  title={typeof window !== "undefined" ? window.location.host || window.location.hostname : ""}
                >
                  {typeof window !== "undefined" ? window.location.host || window.location.hostname : ""}
                </span>
              </div>
            )}
          </div>
          {isMobile && (
            <Button
              variant="minimal"
              icon={<X size={18} />}
              onClick={() => setIsSidebarOpen(false)}
              className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-200"
              aria-label={t("common.close", "关闭")}
            />
          )}
        </div>

        <div className="flex-1 py-4 px-2 overflow-y-auto overflow-x-hidden">
          <Menu className="bg-transparent p-0">
            {navItems.map((item) => (
              <MenuItem
                key={item.id}
                icon={item.icon as any}
                text={showText ? item.label : ""}
                disabled={!isProfileActive}
                active={location.pathname.endsWith(
                  item.id === "stats" ? "/stats" : `/${item.id}`,
                )}
                onClick={() => handleNavClick(item.path)}
              />
            ))}
            <MenuItem
              icon={<ListFilter size={18} />}
              text={showText ? t("nav.filter") : ""}
              disabled={!isProfileActive}
              active={location.pathname.endsWith("/filter")}
              onClick={() => handleNavClick(`/dash/${activeId}/filter`)}
            />
            <MenuItem
              icon={<Settings size={18} />}
              text={showText ? t("nav.settings") : ""}
              disabled={!isProfileActive}
              active={location.pathname.endsWith("/settings")}
              onClick={() => handleNavClick(`/dash/${activeId}/settings`)}
            />
            <li className="my-4 border-t border-gray-100 dark:border-gray-800" />
            <MenuItem
              icon={<UserIcon size={18} />}
              text={showText ? t("common.account") : ""}
              active={location.pathname === "/account"}
              onClick={() => handleNavClick("/account")}
            />
            {currentUser?.role === "admin" && (
              <MenuItem
                icon={<Server size={18} />}
                text={showText ? t("common.system") : ""}
                active={location.pathname === "/system"}
                onClick={() => handleNavClick("/system")}
              />
            )}
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
                    onClick={() => {
                      if (isMobile) setIsSidebarOpen(false);
                      handleLogout();
                    }}
                  />
                </div>
              }
            >
              <MenuItem
                icon={<LogOut size={18} />}
                text={showText ? t("common.logout") : ""}
                intent={Intent.DANGER}
                shouldDismissPopover={false}
              />
            </PopoverNext>
          </Menu>
        </div>

        <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
          {!isMobile && (
            <Button
              variant="minimal"
              icon={<MenuIcon size={18} />}
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            />
          )}
          {showText && (
            <Tag minimal round>
              {currentUser?.username.toUpperCase() || "USER"}
            </Tag>
          )}
        </div>
      </aside>
    </>
  );
};
