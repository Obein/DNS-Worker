import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

import { createProfile, updateProfileSettings, addProfileRule } from "../../services";

export const useImportProfile = (onRefresh?: () => void) => {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);

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

      const created = await createProfile(`${data.name} (Imported)`);
      const newId = created.id;

      await updateProfileSettings(newId, data.settings);

      if (data.rules && Array.isArray(data.rules)) {
        await Promise.all(
          data.rules.map((rule: any) =>
            addProfileRule(newId, {
              type: rule.type,
              pattern: rule.pattern,
              v_a: rule.v_a,
              v_aaaa: rule.v_aaaa,
              v_cname: rule.v_cname,
              v_txt: rule.v_txt,
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

  return {
    fileInputRef,
    importing,
    handleImportClick,
    handleFileChange,
  };
};
