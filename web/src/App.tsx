import { useState, useEffect, useRef, Suspense } from "react";
import { Spinner, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { Routes, Route, useNavigate, useLocation, Navigate } from "react-router-dom";
import { GitHubCorner } from "./components/GithubCorner";
import { lazyWithPreload } from "./utils/lazyWithPreload";
import { DashboardHomeView } from "./views/DashboardHomeView";
import { MainLayout } from "./layouts/MainLayout";
import { NotFoundView } from "./views/NotFoundView";
import { ProfileRoutes } from "./routes/ProfileRoutes";
import type { Profile, UserInfo } from "./types/auth";

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

  const checkAuthAndFetchData = async () => {
    try {
      const [profilesRes, meRes] = await Promise.all([
        fetch("/api/profiles"),
        fetch("/api/account/me"),
      ]);
      if (profilesRes.status === 401 || meRes.status === 401) {
        setIsLoggedIn(false);
        return;
      }
      if (profilesRes.ok && meRes.ok) {
        setProfiles(await profilesRes.json());
        setCurrentUser(await meRes.json());
        setIsLoggedIn(true);
      } else setIsLoggedIn(false);
    } catch (e) {
      setIsLoggedIn(false);
    }
  };

  useEffect(() => {
    checkAuthAndFetchData();
  }, []);

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
    } catch (e) {
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
      setIsLoggedIn(false);
      setSelectedProfile(null);
      window.location.reload();
    } catch (e) {
      console.error("Logout failed", e);
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
              toasterRef={toasterRef}
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
              toasterRef={toasterRef}
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
