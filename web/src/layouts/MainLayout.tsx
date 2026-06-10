import { useEffect } from "react";
import { OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import {
  Edit3,
  BarChart3,
  Clock,
  Download,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { useIsMobile } from "../hooks/useIsMobile";
import type { Profile, UserInfo } from "../types/auth";
import { DesktopSidebar } from "./DesktopSidebar";
import { HeaderNavbar } from "./HeaderNavbar";
import { MobileBottomNav } from "./MobileBottomNav";

/**
 * Properties for the MainLayout component.
 */
interface MainLayoutProps {
  /** The child route views to render. */
  children: React.ReactNode;
  /** True if desktop sidebar is expanded. */
  isSidebarOpen: boolean;
  /** Callback to set desktop sidebar expand/collapse state. */
  setIsSidebarOpen: (open: boolean) => void;
  /** Current active UI theme. */
  theme: "light" | "dark" | "system";
  /** Callback to set UI theme. */
  setTheme: (theme: "light" | "dark" | "system") => void;
  /** Selected Profile object. */
  selectedProfile: Profile | null;
  /** Available profiles list. */
  profiles: Profile[];
  /** Callback to set selected Profile. */
  setSelectedProfile: (p: Profile) => void;
  /** Router location object. */
  location: any;
  /** Router navigation function. */
  navigate: (path: string) => void;
  /** Callback to handle logouts. */
  handleLogout: () => void;
  /** Ref hook to the BlueprintJS OverlayToaster container. */
  toasterRef: React.MutableRefObject<OverlayToaster | null>;
  /** Current logged in user info. */
  currentUser: UserInfo | null;
}

/**
 * MainLayout component establishes the page template framing for all authenticated views.
 * It dynamically alternates between Sidebar layout (for desktops) and Bottom Tab layout (for mobile devices).
 *
 * @param props - Component props containing shared state hooks and layout controllers.
 * @returns React elements representing the page layout template.
 */
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
        <DesktopSidebar
          isSidebarOpen={isSidebarOpen}
          setIsSidebarOpen={setIsSidebarOpen}
          isProfileActive={isProfileActive}
          activeId={activeId}
          location={location}
          navigate={navigate}
          handleLogout={handleLogout}
          currentUser={currentUser}
          navItems={navItems}
        />
      )}

      <main className="flex-1 min-w-0 h-full relative bg-gray-50/20 dark:bg-gray-950/20 flex flex-col overflow-hidden">
        {/* Top Header Navbar */}
        <HeaderNavbar
          theme={theme}
          setTheme={setTheme}
          selectedProfile={selectedProfile}
          isProfileActive={isProfileActive}
          location={location}
          navigate={navigate}
        />

        {/* Page Content */}
        <div className="flex-1 min-h-0 flex flex-col relative">
          {location.pathname.endsWith("/logs") ? (
            <div className="flex-1 overflow-y-auto">{children}</div>
          ) : (
            <div className="flex-1 overflow-y-auto pt-14">
              <div className="p-2 md:p-4 pb-24 md:pb-8">{children}</div>
            </div>
          )}
        </div>

        {/* Mobile Bottom Navigation Bar */}
        {isMobile && (
          <MobileBottomNav
            isProfileActive={isProfileActive}
            navItems={navItems}
            location={location}
            navigate={navigate}
          />
        )}
      </main>
    </div>
  );
};
