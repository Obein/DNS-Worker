import { useState, useRef, Suspense } from "react";
import { Spinner, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import { Routes, Route, useNavigate, useLocation, Navigate, useParams } from "react-router-dom";
import { GitHubCorner } from "./components/GithubCorner";
import { lazyWithPreload } from "./utils/lazyWithPreload";
import { DashboardHomeView } from "./views/DashboardHomeView";
import { MainLayout } from "./layouts/MainLayout";
import { NotFoundView } from "./views/NotFoundView";
import { ProfileRoutes } from "./routes/ProfileRoutes";
import type { Profile } from "./services";
import { useTheme } from "./hooks/useTheme";
import { usePageMeta } from "./hooks/usePageMeta";
import { useAuth } from "./hooks/useAuth";
import { useProfiles } from "./hooks/useProfiles";
import { IdleSessionLock } from "./components/IdleSessionLock";

const AuthView = lazyWithPreload(() =>
  import("./components/AuthView").then((m) => ({ default: m.AuthView })),
);

const AccountView = lazyWithPreload(() =>
  import("./views/AccountView").then((m) => ({ default: m.AccountView })),
);

interface ProfileGuardProps {
  loaded: boolean;
  profiles: Profile[];
  children: React.ReactNode;
}

const ProfileGuard: React.FC<ProfileGuardProps> = ({ loaded, profiles, children }) => {
  const { profileId } = useParams();

  if (!loaded) {
    return (
      <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <Spinner size={50} />
      </div>
    );
  }

  const hasAccess = profiles.some((p) => p.id === profileId);
  if (!hasAccess) {
    return <NotFoundView />;
  }

  return <>{children}</>;
};

function App() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const navigate = useNavigate();
  const location = useLocation();
  const toasterRef = useRef<OverlayToaster | null>(null);
  const { i18n } = useTranslation();

  // Abstracted hooks for theme, page metadata/SEO, and authentication & profile state
  const { theme, setTheme } = useTheme();
  const pageMeta = usePageMeta();
  const {
    isLoggedIn,
    currentUser,
    checkAuth,
    handleLogout,
  } = useAuth(toasterRef);

  const {
    profiles,
    selectedProfile,
    setSelectedProfile,
    showCreateDialog,
    setShowCreateDialog,
    newProfileName,
    setNewProfileName,
    createError,
    prefilledRule,
    setPrefilledRule,
    fetchProfiles,
    handleCreateProfile,
    handleDeleteProfile,
    handleQuickAction,
    loaded,
  } = useProfiles(isLoggedIn);

  if (isLoggedIn === null) {
    return (
      <div className="h-screen flex items-center justify-center">
        <GitHubCorner />
        <Spinner size={50} />
      </div>
    );
  }

  if (!isLoggedIn) {
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
        <AuthView onSuccess={checkAuth} />
      </Suspense>
    );
  }

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
      <IdleSessionLock currentUser={currentUser} handleLogout={handleLogout}>
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
                onRefresh={fetchProfiles}
              />
            }
          />
          <Route
            path="/dash/:profileId/*"
            element={
              <ProfileGuard loaded={loaded} profiles={profiles}>
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
                    currentUser={currentUser}
                  />
                </MainLayout>
              </ProfileGuard>
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
      </IdleSessionLock>
    </Suspense>
  );
}

export default App;
