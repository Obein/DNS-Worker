import { useState, useEffect, useRef } from "react";
import {
  Button,
  Intent,
  NonIdealState,
  Card,
  Elevation,
  H3,
  InputGroup,
  Popover,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  User as UserIcon,
  LogOut,
  ChevronRight,
  Plus,
  Trash2,
  Download,
} from "lucide-react";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import LogoIcon from "../../assets/obex_cat_eye_logo-256.webp";
import { useIsMobile } from "../../hooks/useIsMobile";
import { preloadHeavyViews, preloadMainViews } from "../../routes/ProfileRoutes";
import type { Profile } from "../../types/auth";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    preloadMainViews();
    const timer = setTimeout(preloadHeavyViews, 2000);
    return () => clearTimeout(timer);
  }, []);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!data.settings || !data.name) {
        alert(t("common.invalidFormat", "无效的配置文件格式"));
        return;
      }

      const createRes = await fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${data.name} (Imported)` }),
      });
      if (!createRes.ok) throw new Error("Failed to create profile");
      const { id: newId } = await createRes.json();

      await fetch(`/api/profiles/${newId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.settings),
      });

      if (data.rules && Array.isArray(data.rules)) {
        await Promise.all(
          data.rules.map((rule: any) =>
            fetch(`/api/profiles/${newId}/rules`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                type: rule.type,
                pattern: rule.pattern,
                v_a: rule.v_a,
                v_aaaa: rule.v_aaaa,
                v_cname: rule.v_cname,
                v_txt: rule.v_txt,
              }),
            }),
          ),
        );
      }

      alert(t("common.importSuccess", "配置导入成功"));
      onRefresh?.();
    } catch (e) {
      console.error(e);
      alert(t("common.importError", "导入失败"));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
            <Card
              elevation={Elevation.TWO}
              className="mb-6 p-4 dark:bg-gray-900 dark:border-gray-800 rounded-xl"
            >
              <div className="flex items-center gap-2">
                <InputGroup
                  fill
                  placeholder={t("common.newProfileName")}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <Button
                  intent={Intent.SUCCESS}
                  onClick={onCreate}
                  text={t("common.create")}
                  className="whitespace-nowrap"
                />
                <Button
                  variant="minimal"
                  onClick={() => setShowCreate(false)}
                  icon="cross"
                />
              </div>
              {error && (
                <div className="mt-2 text-red-500 text-xs">
                  {error === "网络错误" ? t("common.errorNetwork") : error}
                </div>
              )}
            </Card>
          )}

          <div className="grid gap-3">
            {profiles.map((p: Profile) => (
              <Card
                key={p.id}
                interactive
                onClick={() => onSelect(p)}
                className="flex justify-between items-center p-4 dark:bg-gray-900 dark:border-gray-800 rounded-xl border border-gray-200"
              >
                <div className="flex flex-col">
                  <span className="font-bold text-base dark:text-white">
                    {p.name}
                  </span>
                  <code className="text-gray-400 text-[10px] font-mono uppercase mt-0.5">
                    {p.id}
                  </code>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="minimal"
                    intent={Intent.DANGER}
                    icon={<Trash2 size={16} />}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(e, p.id);
                    }}
                  />
                  <ChevronRight size={18} className="text-gray-300" />
                </div>
              </Card>
            ))}
            {profiles.length === 0 && (
              <NonIdealState
                icon={<ShieldCheck size={48} className="text-gray-300" />}
                title={t("common.welcome")}
                description={t("common.createProfileToStart")}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
