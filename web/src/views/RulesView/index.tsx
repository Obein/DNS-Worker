import React, { useState, useEffect } from "react";
import { Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

import type {  Rule, RulesViewProps, ProfileSettings  } from "./types";
import { AddRuleCard } from "./components/AddRuleCard";
import { RulesTable } from "./components/RulesTable";
import { EditRuleDialog } from "./components/EditRuleDialog";

export const RulesView: React.FC<RulesViewProps> = ({ profileId, prefill, onPrefillUsed }) => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [, setLoading] = useState(true);
  const { t } = useTranslation();
  const [newRule, setNewRule] = useState<{
    type: string;
    pattern: string;
    v_a: string;
    v_aaaa: string;
    v_txt: string;
    v_cname: string;
  }>({
    type: "BLOCK",
    pattern: "",
    v_a: "",
    v_aaaa: "",
    v_txt: "",
    v_cname: "",
  });

  const [editRule, setEditRule] = useState<Rule | null>(null);

  useEffect(() => {
    if (prefill) {
      setNewRule({
        type: prefill.type,
        pattern: prefill.domain,
        v_a: prefill.recordType === "A" ? "0.0.0.0" : "",
        v_aaaa: prefill.recordType === "AAAA" ? "::" : "",
        v_txt: prefill.recordType === "TXT" ? "Pre-filled" : "",
        v_cname: prefill.recordType === "CNAME" ? "target.com" : "",
      });
      onPrefillUsed?.();
    }
  }, [prefill, onPrefillUsed]);

  const fetchRules = async () => {
    setLoading(true);
    try {
      const [rulesRes, profileRes] = await Promise.all([
        fetch(`/api/profiles/${profileId}/rules`),
        fetch(`/api/profiles/${profileId}`),
      ]);

      if (rulesRes.ok) setRules(await rulesRes.json());
      if (profileRes.ok) {
        const profile = await profileRes.json();
        setSettings(JSON.parse(profile.settings));
      }
    } catch (e) {
      console.error("Failed to fetch data", e);
    } finally {
      setLoading(false);
    }
  };

  const getBlockDetail = () => {
    if (!settings) return t("rules.detailBlock");
    const mode = settings.block_mode || "NULL_IP";
    switch (mode) {
      case "NXDOMAIN":
        return "NXDOMAIN";
      case "NODATA":
        return "NODATA";
      case "CUSTOM_IP":
        return `${settings.custom_block_ipv4 || "0.0.0.0"} / ${settings.custom_block_ipv6 || "::"}`;
      default:
        return "0.0.0.0 / ::";
    }
  };

  const addRule = async () => {
    if (!newRule.pattern) return;
    await fetch(`/api/profiles/${profileId}/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newRule),
    });
    setNewRule({
      type: "BLOCK",
      pattern: "",
      v_a: "",
      v_aaaa: "",
      v_txt: "",
      v_cname: "",
    });
    fetchRules();
  };

  const saveEditRule = async () => {
    if (!editRule || !editRule.pattern) return;
    await fetch(`/api/profiles/${profileId}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editRule),
    });
    setEditRule(null);
    fetchRules();
  };

  const cancelEdit = () => {
    setEditRule(null);
  };

  const startEdit = (rule: Rule) => {
    setEditRule({ ...rule });
  };

  const deleteRule = async (id: number) => {
    await fetch(`/api/profiles/${profileId}/rules`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setEditRule(null);
    fetchRules();
  };

  useEffect(() => {
    fetchRules();
  }, [profileId]);

  return (
    <div className="p-4 md:p-8 w-full min-w-0 max-w-5xl mx-auto">
      <div className="mb-8">
        <h2 className="bp6-heading">{t("rules.title")}</h2>
        <p className="bp6-text-muted">{t("rules.subtitle")}</p>
      </div>

      <AddRuleCard newRule={newRule} setNewRule={setNewRule} addRule={addRule} />

      {rules.length === 0 ? (
        <Callout title={t("rules.noRulesTitle")}>{t("rules.noRulesDesc")}</Callout>
      ) : (
        <RulesTable rules={rules} startEdit={startEdit} getBlockDetail={getBlockDetail} />
      )}

      <EditRuleDialog
        editRule={editRule}
        setEditRule={setEditRule}
        saveEditRule={saveEditRule}
        cancelEdit={cancelEdit}
        deleteRule={deleteRule}
      />
    </div>
  );
};
