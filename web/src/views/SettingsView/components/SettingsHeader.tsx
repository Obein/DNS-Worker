import React, { useState } from "react";
import { Button, InputGroup, Intent, Tooltip, Position } from "@blueprintjs/core";
import { Download, Edit2, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  Profile  } from "../types";
import { PROFILE_NAME_REGEX } from "../../../utils/auth";

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
  const [nameFocused, setNameFocused] = useState(false);

  return (
    <div className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="flex flex-col justify-start">
        {isEditingName ? (
          <div className="flex items-center gap-2 mb-1">
            <Tooltip
              content={t("common.profileNameFormatTip", "Profile Name tip: 1-30 characters, duplicates not allowed")}
              isOpen={nameFocused}
              position={Position.TOP}
              intent={Intent.PRIMARY}
              className="flex-1"
            >
              <div className="w-full block">
                <InputGroup
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") updateProfileName();
                    if (e.key === "Escape") {
                      setIsEditingName(false);
                      setEditName(profile?.name || "");
                    }
                  }}
                />
              </div>
            </Tooltip>
            <Button
              icon={<Check size={16} />}
              intent={Intent.SUCCESS}
              minimal
              onClick={updateProfileName}
              disabled={!PROFILE_NAME_REGEX.test(editName)}
            />
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
