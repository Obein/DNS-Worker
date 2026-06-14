import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

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

  return {
    fileInputRef,
    importing,
    handleImportClick,
    handleFileChange,
  };
};
