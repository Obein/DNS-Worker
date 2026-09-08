import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  createProfile,
  deleteProfile,
  getProfiles,
  updateProfileSettings,
  addProfileRule,
} from "../../services";
import type { GlobalProfileSettings } from "../../services";

interface ExportedRule {
  type: string;
  pattern: string;
  v_a?: string | null;
  v_aaaa?: string | null;
  v_cname?: string | null;
  v_txt?: string | null;
  record_type?: string;
  priority?: number;
}

interface ExportedProfileData {
  version?: number;
  name: string;
  settings: GlobalProfileSettings;
  rules?: ExportedRule[];
  exported_at?: number;
}

export const useImportProfile = (onRefresh?: () => void) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    let createdProfileId: string | null = null;

    try {
      const text = await file.text();
      let data: ExportedProfileData;
      try {
        data = JSON.parse(text) as ExportedProfileData;
      } catch {
        alert(t("common.invalidFormat", "无效文件格式"));
        return;
      }

      if (!data || typeof data !== "object" || !data.settings || !data.name) {
        alert(t("common.invalidFormat", "无效文件格式"));
        return;
      }

      // Fetch existing profiles to avoid duplicate name conflicts
      const existingProfiles = await getProfiles().catch(() => []);
      const existingNames = new Set(
        existingProfiles.map((p) => p.name.trim().toLowerCase())
      );

      // Sanitize base name to match allowed charset
      let baseName = String(data.name).trim();
      baseName = baseName.replace(/[^\p{L}\p{N}_ ()-]/gu, "").trim() || "Imported";

      // Generate current date suffix in MM-DD format (e.g. "07-01")
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const day = String(now.getDate()).padStart(2, "0");
      const dateStr = `${month}-${day}`;
      const suffix = ` (${dateStr})`;

      const truncatedBase = baseName.slice(0, Math.max(1, 30 - suffix.length)).trim();
      let candidateName = `${truncatedBase}${suffix}`;

      let counter = 1;
      while (existingNames.has(candidateName.toLowerCase()) && counter < 100) {
        const numSuffix = ` (${dateStr}-${counter})`;
        const tb = baseName.slice(0, Math.max(1, 30 - numSuffix.length)).trim();
        candidateName = `${tb}${numSuffix}`;
        counter++;
      }

      // Create new profile
      const created = await createProfile(candidateName);
      createdProfileId = created.id;

      // Update settings
      await updateProfileSettings(createdProfileId, data.settings);

      // Import rules sequentially if present, deduplicating identical patterns
      if (data.rules && Array.isArray(data.rules)) {
        const seenPatterns = new Set<string>();
        for (const rule of data.rules) {
          if (
            rule &&
            typeof rule.pattern === "string" &&
            (rule.type === "ALLOW" || rule.type === "BLOCK" || rule.type === "REDIRECT")
          ) {
            const normalizedPattern = rule.pattern.trim().toLowerCase();
            if (!normalizedPattern || seenPatterns.has(normalizedPattern)) {
              continue;
            }
            seenPatterns.add(normalizedPattern);

            try {
              await addProfileRule(createdProfileId, {
                type: rule.type,
                pattern: rule.pattern.trim(),
                v_a: rule.v_a || undefined,
                v_aaaa: rule.v_aaaa || undefined,
                v_cname: rule.v_cname || undefined,
                v_txt: rule.v_txt || undefined,
              });
            } catch (err: unknown) {
              const errMsg = err instanceof Error ? err.message : String(err);
              // Ignore duplicate rule error during import, rethrow any other unexpected errors
              if (!errMsg.includes("Rule for this domain already exists")) {
                throw err;
              }
            }
          }
        }
      }

      alert(t("common.importSuccess", "配置成功导入"));
      onRefresh?.();
    } catch (e: unknown) {
      console.error("[ProfileImport]", e);

      // Rollback created profile on failure to prevent incomplete state
      if (createdProfileId) {
        await deleteProfile(createdProfileId).catch(() => {});
      }

      const errorObj = e as { message?: string } | undefined;
      const rawMsg = errorObj?.message || String(e || "");
      if (rawMsg.startsWith("Profile limit exceeded")) {
        const match = rawMsg.match(/\(max (\d+)\)/);
        const maxVal = match ? match[1] : "10";
        alert(t("common.profileLimitExceeded", { max: maxVal, defaultValue: `Profile limit exceeded (max ${maxVal})` }));
      } else if (rawMsg === "The profile name already exists") {
        alert(t("common.profileNameExists", "该配置名称已存在"));
      } else if (rawMsg === "Invalid Profile Name format") {
        alert(t("common.profileNameFormatError", "配置名称格式不正确"));
      } else {
        alert(rawMsg ? `${t("common.importError", "配置导入失败")}: ${rawMsg}` : t("common.importError", "配置导入失败"));
      }
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return {
    fileInputRef,
    importing,
    handleImportClick,
    handleFileChange,
  };
};
