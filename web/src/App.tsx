import { useState, useEffect, useRef, Suspense } from "react";
import { Spinner, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { GitHubCorner } from "./components/GithubCorner";
import { lazyWithPreload } from "./utils/lazyWithPreload";
import { getAccessToken, setAccessToken } from "./utils/token";
import { DashboardHomeView } from "./views/DashboardHomeView";
import { MainLayout } from "./layouts/MainLayout";
import { NotFoundView } from "./views/NotFoundView";
import { ProfileRoutes } from "./routes/ProfileRoutes";
import type { Profile, UserInfo } from "./types/auth";
import { setSystemTimeZone, setSystemLocale } from "./utils/date";

const AuthView = lazyWithPreload(() =>
  import("./components/AuthView").then((m) => ({ default: m.AuthView })),
);

const AccountView = lazyWithPreload(() =>
  import("./views/AccountView").then((m) => ({ default: m.AccountView })),
);

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [currentUser, setCurrentUser] = useState<UserInfo | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<Profile | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [theme, setTheme] = useState<"light" | "dark" | "system">("dark");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [createError, setCreateError] = useState("");
  const [prefilledRule, setPrefilledRule] = useState<{
    domain: string;
    type: "ALLOW" | "BLOCK" | "REDIRECT";
    recordType?: string;
  } | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const toasterRef = useRef<OverlayToaster | null>(null);
  const { t, i18n } = useTranslation();

  // 获取当前页面的 SEO 信息
  const getPageMeta = (path: string) => {
    let moduleName = "";
    let description = t("meta.defaultDesc", "Secure, fast, and customizable DNS resolution for all your devices. Based on Cloudflare Workers. Open-source and privacy-focused.");
    
    if (path === "/dash") moduleName = t("common.selectProfile");
    else if (path === "/account") moduleName = t("common.account");
    else if (path.endsWith("/setup")) { moduleName = t("nav.setup"); description = t("meta.setupDesc", "Configure your devices to use Obex DNS."); }
    else if (path.endsWith("/filter")) moduleName = t("nav.filter");
    else if (path.endsWith("/rules")) moduleName = t("nav.rules");
    else if (path.endsWith("/settings")) moduleName = t("nav.settings");
    else if (path.endsWith("/stats")) moduleName = t("nav.stats");
    else if (path.endsWith("/logs")) moduleName = t("nav.logs");

    const title = moduleName ? `${moduleName} | Obex DNS` : "Obex DNS";
    return { title, description };
  };

  const pageMeta = getPageMeta(location.pathname);

  useEffect(() => {
    const root = window.document.documentElement;
    const applyTheme = (t: "light" | "dark") => {
      root.classList.remove("light", "dark", "bp6-dark");
      root.classList.add(t);
      if (t === "dark") root.classList.add("bp6-dark");
    };
    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      applyTheme(systemTheme);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  const clearCsrfToken = () => {
    document.cookie = "csrf_token=; Max-Age=0; path=/; Secure; SameSite=Lax";
  };

  const checkAuthAndFetchData = async () => {
    try {
      // 1. Check if we have a csrf_token cookie.
      const hasCsrfToken = document.cookie.includes("csrf_token=");
      if (!hasCsrfToken) {
        setIsLoggedIn(false);
        return;
      }

      // 2. If we don't have an access token in memory, try to refresh first.
      if (!getAccessToken()) {
        const refreshRes = await fetch("/api/auth/refresh", { method: "POST" });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setAccessToken(data.accessToken);
        } else {
          clearCsrfToken();
          setIsLoggedIn(false);
          return;
        }
      }

      // 3. Fetch data (uses token automatically via fetch interceptor).
      const [profilesRes, meRes] = await Promise.all([
        fetch("/api/profiles"),
        fetch("/api/account/me"),
      ]);
      if (profilesRes.status === 401 || meRes.status === 401) {
        clearCsrfToken();
        setIsLoggedIn(false);
        return;
      }
      if (profilesRes.ok && meRes.ok) {
        setProfiles(await profilesRes.json());
        const meData = await meRes.json();
        setCurrentUser(meData);
        if (meData.timezone) {
          setSystemTimeZone(meData.timezone);
        }
        if (meData.locale) {
          setSystemLocale(meData.locale);
          i18n.changeLanguage(meData.locale);
        }
        setIsLoggedIn(true);
      } else {
        setIsLoggedIn(false);
      }
    } catch {
      setIsLoggedIn(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    checkAuthAndFetchData();
  }, []);

  useEffect(() => {
    const handleUnauthorized = (e: Event) => {
      clearCsrfToken();
      setIsLoggedIn(false);
      setSelectedProfile(null);
      
      const customEvent = e as CustomEvent<{ reason?: string }>;
      const reason = customEvent.detail?.reason;
      
      if (reason === "missing") {
        return;
      }
      
      let message = t("auth.unauthorizedDefault");
      if (reason === "geolocation_mismatch" || reason === "geolocation_missing") {
        message = t("auth.unauthorizedGeo");
      } else if (reason === "expired") {
        message = t("auth.unauthorizedExpired");
      } else if (reason === "token_reuse") {
        message = t("auth.unauthorizedReuse");
      } else if (reason === "session_not_found") {
        message = t("auth.unauthorizedRevoked");
      }

      if (toasterRef.current) {
        toasterRef.current.show({
          message,
          intent: "danger",
          icon: "error",
          timeout: 5000,
        });
      }
    };

    window.addEventListener("auth_unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("auth_unauthorized", handleUnauthorized);
    };
  }, [t]);

  const handleCreateProfile = async () => {
    if (!newProfileName) return;
    try {
      const res = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProfileName }),
      });
      if (res.ok) {
        setNewProfileName("");
        setShowCreateDialog(false);
        await checkAuthAndFetchData();
      } else setCreateError(await res.text());
    } catch {
      setCreateError(t("common.errorNetwork"));
    }
  };

  const handleDeleteProfile = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm(t("common.confirmDelete"))) return;
    try {
      const res = await fetch(`/api/profiles/${id}`, { method: "DELETE" });
      if (res.ok) await checkAuthAndFetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
      console.error("Logout failed", e);
    } finally {
      clearCsrfToken();
      setIsLoggedIn(false);
      setSelectedProfile(null);
      window.location.reload();
    }
  };

  const handleQuickAction = (
    domain: string,
    type: "ALLOW" | "BLOCK" | "REDIRECT",
    recordType?: string,
  ) => {
    setPrefilledRule({ domain, type, recordType });
    const profileId = selectedProfile?.id || location.pathname.split("/")[2];
    if (profileId) navigate(`/dash/${profileId}/rules`);
  };

  if (isLoggedIn === null)
    return (
      <div className="h-screen flex items-center justify-center">
        <GitHubCorner />
        <Spinner size={50} />
      </div>
    );
  if (!isLoggedIn)
    return (
      <Suspense
        fallback={
          <div className="h-screen flex items-center justify-center">
            <Spinner size={50} />
          </div>
        }
      >
        <Helmet>
          <title>{pageMeta.title}</title>
          <meta name="description" content={pageMeta.description} />
          <html lang={i18n.language} />
        </Helmet>
        <GitHubCorner />
        <OverlayToaster position="bottom" ref={toasterRef} />
        <AuthView onSuccess={checkAuthAndFetchData} />
      </Suspense>
    );

  return (
    <Suspense
      fallback={
        <div className="h-screen flex items-center justify-center">
          <Spinner size={50} />
        </div>
      }
    >
      <Helmet>
        <title>{pageMeta.title}</title>
        <meta name="description" content={pageMeta.description} />
        <html lang={i18n.language} />
      </Helmet>
      <GitHubCorner />
      <OverlayToaster position="bottom" ref={toasterRef} />
      <Routes>
        <Route path="/" element={<Navigate to="/dash" replace />} />
        <Route
          path="/dash"
          element={
            <DashboardHomeView
              profiles={profiles}
              onSelect={(p: Profile) => {
                setSelectedProfile(p);
                navigate(`/dash/${p.id}/setup`);
              }}
              onCreate={handleCreateProfile}
              showCreate={showCreateDialog}
              setShowCreate={setShowCreateDialog}
              newName={newProfileName}
              setNewName={setNewProfileName}
              error={createError}
              onDelete={handleDeleteProfile}
              handleLogout={handleLogout}
              navigate={navigate}
              onRefresh={checkAuthAndFetchData}
            />
          }
        />
        <Route
          path="/dash/:profileId/*"
          element={
            <MainLayout
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              theme={theme}
              setTheme={setTheme}
              selectedProfile={selectedProfile}
              profiles={profiles}
              setSelectedProfile={setSelectedProfile}
              location={location}
              navigate={navigate}
              handleLogout={handleLogout}
              currentUser={currentUser}
            >
              <ProfileRoutes
                selectedProfile={selectedProfile}
                prefilledRule={prefilledRule}
                setPrefilledRule={setPrefilledRule}
                handleQuickAction={handleQuickAction}
                toasterRef={toasterRef}
              />
            </MainLayout>
          }
        />
        <Route
          path="/account"
          element={
            <MainLayout
              isSidebarOpen={isSidebarOpen}
              setIsSidebarOpen={setIsSidebarOpen}
              theme={theme}
              setTheme={setTheme}
              selectedProfile={selectedProfile}
              profiles={profiles}
              setSelectedProfile={setSelectedProfile}
              location={location}
              navigate={navigate}
              handleLogout={handleLogout}
              currentUser={currentUser}
            >
              <AccountView />
            </MainLayout>
          }
        />
        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </Suspense>
  );
}

export default App;
