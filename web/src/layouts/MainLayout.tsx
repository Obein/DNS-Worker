import { useEffect } from "react";
import {
  Button,
  Navbar,
  Alignment,
  Intent,
  Tag,
  Menu,
  MenuItem,
  Popover,
  OverlayToaster,
  Icon,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import {
  ListFilter,
  Edit3,
  Settings,
  BarChart3,
  Clock,
  User as UserIcon,
  LogOut,
  Moon,
  Sun,
  Monitor,
  Menu as MenuIcon,
  Download,
} from "lucide-react";
import { clsx } from "clsx";
import { useParams } from "react-router-dom";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Profile, UserInfo } from "../types/auth";

interface MainLayoutProps {
  children: React.ReactNode;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  selectedProfile: Profile | null;
  profiles: Profile[];
  setSelectedProfile: (p: Profile) => void;
  location: any;
  navigate: (path: string) => void;
  handleLogout: () => void;
  toasterRef: React.MutableRefObject<OverlayToaster | null>;
  currentUser: UserInfo | null;
}

export const MainLayout = ({
  children,
  isSidebarOpen,
  setIsSidebarOpen,
  theme,
  setTheme,
  selectedProfile,
  profiles,
  setSelectedProfile,
  location,
  navigate,
  handleLogout,
  toasterRef,
  currentUser,
}: MainLayoutProps) => {
  const { profileId: urlProfileId } = useParams();
  const isMobile = useIsMobile();
  const { t } = useTranslation();
  const activeId = urlProfileId || selectedProfile?.id;
  const isProfileActive = !!activeId;

  useEffect(() => {
    if (
      urlProfileId &&
      profiles.length > 0 &&
      selectedProfile?.id !== urlProfileId
    ) {
      const found = profiles.find((p: Profile) => p.id === urlProfileId);
      if (found) setSelectedProfile(found);
    }
  }, [urlProfileId, profiles, selectedProfile, setSelectedProfile]);

  const navItems = [
    {
      id: "setup",
      label: t("nav.setup"),
      icon: <Download size={20} />,
      path: `/dash/${activeId}/setup`,
    },
    {
      id: "rules",
      label: t("nav.rules"),
      icon: <Edit3 size={20} />,
      path: `/dash/${activeId}/rules`,
    },
    {
      id: "stats",
      label: t("nav.stats"),
      icon: <BarChart3 size={20} />,
      path: `/dash/${activeId}/stats`,
    },
    {
      id: "logs",
      label: t("nav.logs"),
      icon: <Clock size={20} />,
      path: `/dash/${activeId}/logs`,
    },
  ];

  return (
    <div className="flex h-screen w-full bg-white dark:bg-gray-950 overflow-hidden flex-col md:flex-row">
      <OverlayToaster position="bottom" ref={toasterRef} />

      {!isMobile && (
        <aside
          className={clsx(
            "flex flex-col border-r border-gray-200 dark:border-gray-800 transition-all duration-300 bg-white dark:bg-gray-900",
            isSidebarOpen ? "w-64" : "w-16",
          )}
        >
          <div className="h-14 flex items-center px-4 shrink-0">
            <img
              src={LogoIcon}
              alt="Obex DNS"
              className="w-8 h-8 object-contain shrink-0"
            />
            {isSidebarOpen && (
              <span className="ml-3 font-bold text-lg dark:text-white">
                Obex DNS
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
              <Popover
                className="w-full"
                position="right-bottom"
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
              </Popover>
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
      )}

      <main className="flex-1 min-w-0 h-full relative bg-gray-50/20 dark:bg-gray-950/20 flex flex-col overflow-hidden">
        {/* 顶部导航栏 */}
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

        {/* 页面内容 - 分情况处理滚动 */}
        <div className="flex-1 min-h-0 flex flex-col relative">
          {location.pathname.endsWith("/logs") ? (
            <div className="flex-1 overflow-y-auto">{children}</div>
          ) : (
            <div className="flex-1 overflow-y-auto pt-14">
              <div className="p-2 md:p-4 pb-24 md:pb-8">{children}</div>
            </div>
          )}
        </div>

        {/* 移动端底部导航 */}
        {isMobile && isProfileActive && (
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
        )}
      </main>
    </div>
  );
};
