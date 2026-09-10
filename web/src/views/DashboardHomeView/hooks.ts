import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";

import {
  createProfile,
  deleteProfile,
  getProfiles,
  updateProfileSettings,
  addProfileRule,
  addProfileRulesBulk,
  addProfileListsBulk,
  addCustomProfileList,
} from "../../services";
import type { GlobalProfileSettings, Rule } from "../../services";

interface ExportedRule {
  type: string;
  pattern: string;
  v_a?: string | null;
  v_aaaa?: string | null;
  v_cname?: string | null;
  v_txt?: string | null;
  record_type?: string;
  priority?: number;
  created_at?: number;
}

interface ExportedFilter {
  url?: string;
  link?: string;
  uri?: string;
  address?: string;
  source?: string;
  target?: string;
  download_url?: string;
  enabled?: boolean;
}

interface ExportedProfileData {
  version?: number;
  name: string;
  settings: GlobalProfileSettings & {
    filters?: (string | ExportedFilter)[] | Record<string, unknown>;
    filter?: (string | ExportedFilter)[] | string | Record<string, unknown>;
    lists?: (string | ExportedFilter)[] | Record<string, unknown>;
    list?: (string | ExportedFilter)[] | string | Record<string, unknown>;
    blocklists?: (string | ExportedFilter)[] | Record<string, unknown>;
    blocklist?: (string | ExportedFilter)[] | string | Record<string, unknown>;
  };
  rules?: ExportedRule[];
  filters?: (string | ExportedFilter)[] | Record<string, unknown>;
  filter?: (string | ExportedFilter)[] | string | Record<string, unknown>;
  lists?: (string | ExportedFilter)[] | Record<string, unknown>;
  list?: (string | ExportedFilter)[] | string | Record<string, unknown>;
  blocklists?: (string | ExportedFilter)[] | Record<string, unknown>;
  blocklist?: (string | ExportedFilter)[] | string | Record<string, unknown>;
  subscriptions?: (string | ExportedFilter)[] | Record<string, unknown>;
  subscription?: (string | ExportedFilter)[] | string | Record<string, unknown>;
  external_filters?: (string | ExportedFilter)[] | Record<string, unknown>;
  exported_at?: number;
}

/**
 * Current supported profile export schema version.
 * - v1: Legacy format (settings and rules only)
 * - v2: Extended format (settings, rules, and external subscription filter lists)
 */
export const CURRENT_PROFILE_SCHEMA_VERSION = 2;

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

      // Schema version check: v1 (rules only), v2 (rules + external filters)
      const fileVersion = typeof data.version === "number" ? data.version : 1;
      if (fileVersion > CURRENT_PROFILE_SCHEMA_VERSION) {
        console.warn(
          `[ProfileImport] File version (${fileVersion}) is newer than supported version (${CURRENT_PROFILE_SCHEMA_VERSION}). Proceeding with backward-compatible import.`
        );
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

      // Batch import rules if present
      if (data.rules && Array.isArray(data.rules) && data.rules.length > 0) {
        const seenPatterns = new Set<string>();
        const validRules: Omit<Rule, "id">[] = [];
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
            validRules.push({
              type: rule.type,
              pattern: rule.pattern.trim(),
              v_a: rule.v_a || undefined,
              v_aaaa: rule.v_aaaa || undefined,
              v_cname: rule.v_cname || undefined,
              v_txt: rule.v_txt || undefined,
              created_at: typeof rule.created_at === "number" ? rule.created_at : undefined,
            });
          }
        }

        if (validRules.length > 0) {
          try {
            await addProfileRulesBulk(createdProfileId, validRules);
          } catch (bulkErr) {
            console.warn("[ProfileImport] Bulk rules failed, falling back to sequential:", bulkErr);
            for (const r of validRules) {
              try {
                await addProfileRule(createdProfileId, r);
              } catch (seqErr: unknown) {
                const msg = seqErr instanceof Error ? seqErr.message : String(seqErr);
                if (!msg.includes("Rule for this domain already exists")) {
                  throw seqErr;
                }
              }
            }
          }
        }
      }

      // Batch import filters / subscription lists if present with maximum flexibility across keys and formats
      const extractFilterCandidates = (cfg: ExportedProfileData): unknown[] => {
        if (!cfg || typeof cfg !== "object") return [];
        const raw =
          cfg.filters ??
          cfg.filter ??
          cfg.lists ??
          cfg.list ??
          cfg.blocklists ??
          cfg.blocklist ??
          cfg.subscriptions ??
          cfg.subscription ??
          cfg.external_filters ??
          cfg.settings?.filters ??
          cfg.settings?.filter ??
          cfg.settings?.lists ??
          cfg.settings?.list ??
          cfg.settings?.blocklists ??
          cfg.settings?.blocklist;

        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        if (typeof raw === "string") return [raw];
        if (typeof raw === "object") {
          const list: unknown[] = [];
          for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
            if (typeof v === "string") {
              list.push(v);
            } else if (typeof v === "boolean" || typeof v === "number") {
              list.push({ url: k, enabled: Boolean(v) });
            } else if (v && typeof v === "object") {
              list.push(v);
            }
          }
          return list;
        }
        return [];
      };

      const parseFilterItem = (item: unknown): { url: string; enabled: boolean } | null => {
        if (!item) return null;
        let rawUrl = "";
        let enabled = true;

        if (typeof item === "string") {
          rawUrl = item.trim();
        } else if (typeof item === "object") {
          const rec = item as Record<string, unknown>;
          if (rec.enabled !== undefined) {
            enabled = Boolean(rec.enabled);
          }
          if (typeof rec.url === "string") {
            rawUrl = rec.url.trim();
          } else if (typeof rec.link === "string") {
            rawUrl = rec.link.trim();
          } else if (typeof rec.uri === "string") {
            rawUrl = rec.uri.trim();
          } else if (typeof rec.address === "string") {
            rawUrl = rec.address.trim();
          } else if (typeof rec.source === "string") {
            rawUrl = rec.source.trim();
          } else if (typeof rec.target === "string") {
            rawUrl = rec.target.trim();
          } else if (typeof rec.download_url === "string") {
            rawUrl = rec.download_url.trim();
          } else {
            for (const val of Object.values(rec)) {
              if (typeof val === "string" && (val.startsWith("http://") || val.startsWith("https://") || val.startsWith("//"))) {
                rawUrl = val.trim();
                break;
              }
            }
          }
        }

        rawUrl = rawUrl.replace(/^["']|["']$/g, "").trim();

        if (rawUrl.startsWith("//")) {
          rawUrl = `https:${rawUrl}`;
        } else if (!rawUrl.startsWith("http://") && !rawUrl.startsWith("https://")) {
          if (rawUrl.includes(".") && !rawUrl.includes(" ") && rawUrl.length > 3) {
            rawUrl = `https://${rawUrl}`;
          } else {
            return null;
          }
        }

        return { url: rawUrl, enabled };
      };

      const rawFilters = extractFilterCandidates(data);
      if (rawFilters.length > 0) {
        const seenUrls = new Set<string>();
        const validFilters: { url: string; enabled: boolean }[] = [];
        for (const f of rawFilters) {
          const parsed = parseFilterItem(f);
          if (!parsed) continue;
          const norm = parsed.url.toLowerCase();
          if (seenUrls.has(norm)) continue;
          seenUrls.add(norm);
          validFilters.push(parsed);
        }

        if (validFilters.length > 0) {
          try {
            await addProfileListsBulk(createdProfileId, validFilters);
          } catch (bulkErr) {
            console.warn("[ProfileImport] Bulk filter import failed, falling back to sequential:", bulkErr);
            for (const f of validFilters) {
              try {
                await addCustomProfileList(createdProfileId, f.url);
              } catch (seqErr) {
                console.warn("[ProfileImport] Failed to sequentially import filter:", f.url, seqErr);
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
      if (e.target) e.target.value = "";
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
