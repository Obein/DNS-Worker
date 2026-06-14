import { useEffect } from "react";
import { Button, Intent, H3 } from "@blueprintjs/core";
import { Plus, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useIsMobile } from "../../hooks/useIsMobile";
import { preloadHeavyViews, preloadMainViews } from "../../routes/ProfileRoutes";
import type { Profile } from "../../types/auth";
import { useImportProfile } from "./hooks";
import { Navbar } from "./components/Navbar";
import { CreateProfileCard } from "./components/CreateProfileCard";
import { ProfileList } from "./components/ProfileList";

interface DashboardHomeProps {
  profiles: Profile[];
  onSelect: (p: Profile) => void;
  onCreate: () => void;
  showCreate: boolean;
  setShowCreate: (show: boolean) => void;
  newName: string;
  setNewName: (name: string) => void;
  error: string;
  onDelete: (e: React.MouseEvent, id: string) => void;
  handleLogout: () => void;
  navigate: (path: string) => void;
  onRefresh?: () => void;
}

export const DashboardHomeView = ({
  profiles,
  onSelect,
  onCreate,
  showCreate,
  setShowCreate,
  newName,
  setNewName,
  error,
  onDelete,
  handleLogout,
  navigate,
  onRefresh,
}: DashboardHomeProps) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  const {
    fileInputRef,
    importing,
    handleImportClick,
    handleFileChange,
  } = useImportProfile(onRefresh);

  useEffect(() => {
    preloadMainViews();
    const timer = setTimeout(preloadHeavyViews, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex flex-col">
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept=".json"
        onChange={handleFileChange}
      />
      
      {/* 顶部导航栏 - 玻璃拟态 */}
      <Navbar
        isMobile={isMobile}
        navigate={navigate}
        handleLogout={handleLogout}
      />

      <div className="flex-1 flex flex-col items-center justify-start md:justify-center p-4 pt-8 md:pt-4">
        <div className="w-full max-w-md">
          <div className="flex justify-between items-center mb-6">
            <H3
              className="dark:text-white font-bold"
              style={{ marginBottom: 0 }}
            >
              {t("common.selectProfile")}
            </H3>
            <div className="flex gap-1">
              <Button
                variant="minimal"
                icon={<Download size={16} />}
                onClick={handleImportClick}
                text={isMobile ? "" : t("common.import", "导入")}
                loading={importing}
              />
              <Button
                variant="minimal"
                intent={Intent.PRIMARY}
                icon={<Plus size={18} />}
                onClick={() => setShowCreate(true)}
                text={t("common.add")}
                disabled={showCreate}
              />
            </div>
          </div>

          {showCreate && (
            <CreateProfileCard
              newName={newName}
              setNewName={setNewName}
              onCreate={onCreate}
              setShowCreate={setShowCreate}
              error={error}
            />
          )}

          <ProfileList
            profiles={profiles}
            onSelect={onSelect}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
};
