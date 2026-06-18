import React, { useState, useEffect } from "react";
import { Callout, Intent, ButtonGroup, Button } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";

import type {  Rule, RulesViewProps, ProfileSettings  } from "./types";
import { AddRuleCard } from "./components/AddRuleCard";
import { RulesTable } from "./components/RulesTable";
import { EditRuleDialog } from "./components/EditRuleDialog";
import { useIsMobile } from "../../hooks/useIsMobile";

export const RulesView: React.FC<RulesViewProps> = ({ profileId, prefill, onPrefillUsed, toasterRef }) => {
  const navigate = useNavigate();
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [, setLoading] = useState(true);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
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
    const trimmedPattern = newRule.pattern.trim();
    if (!trimmedPattern) {
      toasterRef?.current?.show({
        message: t("rules.patternEmpty", "Domain pattern cannot be empty"),
        intent: Intent.DANGER,
      });
      return;
    }
    const normalizedPattern = trimmedPattern.toLowerCase();
    if (rules.some(r => r.pattern.trim().toLowerCase() === normalizedPattern)) {
      toasterRef?.current?.show({
        message: t("rules.duplicatePattern", "Rule for this domain already exists"),
        intent: Intent.DANGER,
      });
      return;
    }
    try {
      const response = await fetch(`/api/profiles/${profileId}/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newRule, pattern: trimmedPattern }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        toasterRef?.current?.show({
          message: errorText || t("rules.addFailed", "Failed to add rule"),
          intent: Intent.DANGER,
        });
        return;
      }
      toasterRef?.current?.show({
        message: t("rules.addSuccess", "Rule added successfully"),
        intent: Intent.SUCCESS,
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
    } catch (e) {
      toasterRef?.current?.show({
        message: t("rules.addFailed", "Failed to add rule"),
        intent: Intent.DANGER,
      });
    }
  };

  const saveEditRule = async () => {
    if (!editRule) return;
    const trimmedPattern = editRule.pattern.trim();
    if (!trimmedPattern) {
      toasterRef?.current?.show({
        message: t("rules.patternEmpty", "Domain pattern cannot be empty"),
        intent: Intent.DANGER,
      });
      return;
    }
    const normalizedPattern = trimmedPattern.toLowerCase();
    if (rules.some(r => r.id !== editRule.id && r.pattern.trim().toLowerCase() === normalizedPattern)) {
      toasterRef?.current?.show({
        message: t("rules.duplicatePattern", "Rule for this domain already exists"),
        intent: Intent.DANGER,
      });
      return;
    }
    try {
      const response = await fetch(`/api/profiles/${profileId}/rules`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editRule, pattern: trimmedPattern }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        toasterRef?.current?.show({
          message: errorText || t("rules.updateFailed", "Failed to update rule"),
          intent: Intent.DANGER,
        });
        return;
      }
      toasterRef?.current?.show({
        message: t("rules.updateSuccess", "Rule updated successfully"),
        intent: Intent.SUCCESS,
      });
      setEditRule(null);
      fetchRules();
    } catch (e) {
      toasterRef?.current?.show({
        message: t("rules.updateFailed", "Failed to update rule"),
        intent: Intent.DANGER,
      });
    }
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
    <div className={clsx("md:p-8 w-full min-w-0 max-w-5xl mx-auto", isMobile ? "p-1" : "p-8")}>
      <div className="mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start gap-4">
          <div className="w-full md:w-auto flex-1">
            {isMobile ? (
              <ButtonGroup minimal fill={isMobile}>
                <Button
                  active={true}
                  onClick={() => navigate(`/dash/${profileId}/rules`)}
                  text={t("rules.title")}
                  large
                />
                <Button
                  active={false}
                  onClick={() => navigate(`/dash/${profileId}/filter`)}
                  text={t("filtering.title")}
                  large
                />
              </ButtonGroup>
            ) : (
              <h1 className="bp6-heading">{t("rules.title")}</h1>
            )}
            <p className="bp6-text-muted mt-2!">{t("rules.subtitle")}</p>
          </div>
        </div>
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
