import React from "react";
import { Button, InputGroup, Intent } from "@blueprintjs/core";
import { Download, Edit2, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  Profile  } from "../types";

export interface SettingsHeaderProps {
  profile: Profile | null;
  isEditingName: boolean;
  setIsEditingName: (val: boolean) => void;
  editName: string;
  setEditName: (val: string) => void;
  updateProfileName: () => void;
  exportProfile: () => void;
  saveSettings: () => void;
  saving: boolean;
}

export const SettingsHeader: React.FC<SettingsHeaderProps> = ({
  profile,
  isEditingName,
  setIsEditingName,
  editName,
  setEditName,
  updateProfileName,
  exportProfile,
  saveSettings,
  saving,
}) => {
  const { t } = useTranslation();

  return (
    <div className="mb-6 flex justify-between items-center">
      <div className="flex flex-col justify-start">
        {isEditingName ? (
          <div className="flex items-center gap-2 mb-1">
            <InputGroup
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") updateProfileName();
                if (e.key === "Escape") {
                  setIsEditingName(false);
                  setEditName(profile?.name || "");
                }
              }}
            />
            <Button icon={<Check size={16} />} intent={Intent.SUCCESS} minimal onClick={updateProfileName} />
            <Button
              icon={<X size={16} />}
              minimal
              onClick={() => {
                setIsEditingName(false);
                setEditName(profile?.name || "");
              }}
            />
          </div>
        ) : (
          <div className="group flex items-center gap-2 mb-1 cursor-pointer" onClick={() => setIsEditingName(true)}>
            <h2 className="bp6-heading mb-0">{profile?.name}</h2>
            <Button icon={<Edit2 size={14} />} minimal className="opacity-30 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
        <p className="bp6-text-muted">{t("settings.subtitle")}</p>
      </div>
      <div className="flex gap-2">
        <Button size="large" icon={<Download size={18} />} text={t("settings.export", "导出配置")} onClick={exportProfile} />
        <Button
          size="large"
          intent={Intent.PRIMARY}
          icon="floppy-disk"
          text={t("settings.saveChanges")}
          onClick={saveSettings}
          loading={saving}
        />
      </div>
    </div>
  );
};
