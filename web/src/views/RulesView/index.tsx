import React, { useState, useEffect, useMemo } from "react";
import { Callout, Intent, ButtonGroup, Button, Tag, PopoverNext, Spinner } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { clsx } from "clsx";

import type { Rule, RulesViewProps, ProfileSettings } from "./types";
import { AddRuleCard } from "./components/AddRuleCard";
import { RulesTable } from "./components/RulesTable";
import { EditRuleDialog } from "./components/EditRuleDialog";
import { useIsMobile } from "../../hooks/useIsMobile";
import {
  getProfileRules,
  getProfileDetails,
  addProfileRule,
  updateProfileRule,
  deleteProfileRule,
  getClientInfo,
} from "../../services";

export const RulesView: React.FC<RulesViewProps> = ({ profileId, prefill, onPrefillUsed, toasterRef }) => {
  const navigate = useNavigate();
  const [rules, setRules] = useState<Rule[]>([]);
  const [settings, setSettings] = useState<ProfileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const [newRule, setNewRule] = useState<{
    type: Rule["type"];
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
  const [substituteDomain, setSubstituteDomain] = useState<string>("www.okx.com");
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  useEffect(() => {
    getClientInfo()
      .then((info) => {
        if (info.substituteDomain) {
          setSubstituteDomain(info.substituteDomain);
        }
      })
      .catch((e) => console.warn("Failed to fetch clientInfo for substituteDomain:", e));
  }, []);

  const hasSelfRedirect = useMemo(() => {
    const currentHost = window.location.hostname.trim().toLowerCase();
    if (!currentHost) return false;
    return rules.some((r) => {
      if (r.type !== "REDIRECT") return false;
      const pattern = r.pattern.trim().toLowerCase();
      return pattern === currentHost || pattern === `*.${currentHost}`;
    });
  }, [rules]);

  const handleApplySelfRedirect = () => {
    setIsPromptOpen(false);
    setNewRule({
      type: "REDIRECT",
      pattern: window.location.hostname,
      v_a: "",
      v_aaaa: "",
      v_txt: "",
      v_cname: substituteDomain || "www.okx.com",
    });
    setTimeout(() => {
      document.getElementById("rule-pattern")?.focus();
    }, 100);
  };

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
      const [rulesData, profileData] = await Promise.all([
        getProfileRules(profileId),
        getProfileDetails(profileId),
      ]);

      setRules(rulesData);
      setSettings(JSON.parse(profileData.settings || "{}"));
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
    setIsAdding(true);
    try {
      await addProfileRule(profileId, { ...newRule, pattern: trimmedPattern });
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
      await fetchRules();
    } catch (e: any) {
      toasterRef?.current?.show({
        message: e.message || t("rules.addFailed", "Failed to add rule"),
        intent: Intent.DANGER,
      });
    } finally {
      setIsAdding(false);
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
    setIsSaving(true);
    try {
      await updateProfileRule(profileId, { ...editRule, pattern: trimmedPattern } as Rule);
      toasterRef?.current?.show({
        message: t("rules.updateSuccess", "Rule updated successfully"),
        intent: Intent.SUCCESS,
      });
      setEditRule(null);
      await fetchRules();
    } catch (e: any) {
      toasterRef?.current?.show({
        message: e.message || t("rules.updateFailed", "Failed to update rule"),
        intent: Intent.DANGER,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditRule(null);
  };

  const startEdit = (rule: Rule) => {
    setEditRule({ ...rule });
  };

  const deleteRule = async (id: number) => {
    setIsDeleting(true);
    try {
      await deleteProfileRule(profileId, id);
    } catch (e) {
      console.error(e);
    } finally {
      setIsDeleting(false);
    }
    setEditRule(null);
    await fetchRules();
  };

  useEffect(() => {
    fetchRules();
  }, [profileId]);

  return (
    <div className={clsx("md:px-8 w-full min-w-0 max-w-5xl mx-auto", isMobile ? "p-1" : "px-8")}>
      <div className="mb-8">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="w-full md:w-auto flex-1">
            {isMobile ? (
              <div className="flex items-center gap-2">
                <ButtonGroup minimal fill={isMobile} className="flex-1">
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
                {loading && <Spinner size={16} />}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <h1 className="bp6-heading m-0">{t("rules.title")}</h1>
                {loading && <Spinner size={20} />}
              </div>
            )}
            <p className="bp6-text-muted mt-2!">{t("rules.subtitle")}</p>
          </div>

          {!loading && !hasSelfRedirect && (
            <div className="flex items-center gap-3 self-start md:self-auto">
              <PopoverNext
                isOpen={isPromptOpen}
                onInteraction={setIsPromptOpen}
                placement="bottom-end"
                portalClassName="z-20000"
                content={
                  <div className="p-4 w-72 sm:w-80 space-y-3 text-sm">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed m-0">
                      {t("rules.addSelfRedirectPrompt", "是否增加指向本站的 CNAME 规则，用于地区网络优化（中国大陆用户推荐）？")}
                    </p>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="small"
                        variant="minimal"
                        text={t("common.no", "否")}
                        onClick={() => setIsPromptOpen(false)}
                      />
                      <Button
                        size="small"
                        intent={Intent.PRIMARY}
                        text={t("common.yes", "是")}
                        onClick={handleApplySelfRedirect}
                      />
                    </div>
                  </div>
                }
              >
                <Tag
                  minimal
                  interactive
                  intent={Intent.PRIMARY}
                  className="cursor-pointer select-none font-medium"
                >
                  {t("rules.addSelfRedirectTag", "增加本站重定向？")}
                </Tag>
              </PopoverNext>
            </div>
          )}
        </div>
      </div>

      <AddRuleCard newRule={newRule} setNewRule={setNewRule} addRule={addRule} loading={isAdding} />

      {loading && rules.length === 0 ? (
        <div className="p-16 flex flex-col justify-center items-center gap-3">
          <Spinner size={32} />
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
            {t("common.loading", "加载中...")}
          </span>
        </div>
      ) : rules.length === 0 ? (
        <Callout title={t("rules.noRulesTitle")}>{t("rules.noRulesDesc")}</Callout>
      ) : (
        <div className="relative">
          {loading && (
            <div className="absolute inset-0 bg-white/40 dark:bg-gray-900/40 backdrop-blur-xs flex items-center justify-center z-10 rounded-lg">
              <Spinner size={32} />
            </div>
          )}
          <RulesTable rules={rules} startEdit={startEdit} getBlockDetail={getBlockDetail} />
        </div>
      )}

      <EditRuleDialog
        editRule={editRule}
        setEditRule={setEditRule}
        saveEditRule={saveEditRule}
        cancelEdit={cancelEdit}
        deleteRule={deleteRule}
        isSaving={isSaving}
        isDeleting={isDeleting}
      />
    </div>
  );
};
