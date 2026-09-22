import React, { useState, useRef } from "react";
import { Dialog, Button, Intent, Callout, Switch, InputGroup, Tag } from "@blueprintjs/core";
import { Copy, ExternalLink, Trash2, Search, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import { checkDomainAgainstList, type ListCheckResult } from "../../../services";
import type { FilterList } from "../types";

export interface ListDetailsDialogProps {
  profileId: string;
  selectedList: FilterList | null;
  onClose: () => void;
  onCopy: (url: string) => void;
  onDelete: (id: number) => void;
  /** Enables or disables the list; the parent refetches and the filter is rebuilt. */
  onToggleEnabled: (id: number, enabled: boolean) => Promise<void>;
  /** Adds an ALLOW rule so this domain resolves even while the list blocks it. */
  onAllowDomain: (domain: string) => Promise<void>;
}

export const ListDetailsDialog: React.FC<ListDetailsDialogProps> = ({
  profileId,
  selectedList,
  onClose,
  onCopy,
  onDelete,
  onToggleEnabled,
  onAllowDomain,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ListCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [toggling, setToggling] = useState(false);
  /** Monotonic id of the newest check, so stale responses can be discarded. */
  const checkToken = useRef(0);

  const reset = () => {
    // Invalidate any in-flight check so its response cannot land after this.
    // Clearing `checking` here is required, not cosmetic: the settled promise's
    // finally block is guarded by the token, so it will decline to clear it and
    // the Check button would stay loading for the life of the component.
    checkToken.current++;
    setChecking(false);
    setQuery("");
    setResult(null);
    setError(null);
    setAllowed(false);
  };

  const runCheck = async () => {
    const domain = query.trim().toLowerCase();
    if (!domain || !selectedList) return;
    // Tag this request. Closing the dialog mid-flight and reopening it on a
    // different list would otherwise let the late response paint list A's
    // verdict under list B's header.
    const token = ++checkToken.current;
    const listId = selectedList.id;
    setChecking(true);
    setError(null);
    setResult(null);
    setAllowed(false);
    try {
      const res = await checkDomainAgainstList(profileId, listId, domain);
      if (checkToken.current === token) setResult(res);
    } catch (err) {
      if (checkToken.current === token) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (checkToken.current === token) setChecking(false);
    }
  };

  const handleToggle = async (enabled: boolean) => {
    if (!selectedList) return;
    setToggling(true);
    try {
      await onToggleEnabled(selectedList.id, enabled);
    } finally {
      setToggling(false);
    }
  };

  const handleAllow = async () => {
    if (!result?.matchedEntry) return;
    setAllowing(true);
    try {
      // Scope the exception to what was asked about. matchedEntry may be a
      // parent, and an ALLOW rule matches the pattern plus all its subdomains,
      // so allowing it would un-block every sibling too.
      await onAllowDomain(result.domain);
      setAllowed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAllowing(false);
    }
  };

  return (
    <Dialog
      isOpen={selectedList !== null}
      onClose={() => { reset(); onClose(); }}
      title={t("filtering.listDetails", "List Details")}
      icon="info-sign"
    >
      <div className="p-6 space-y-4">
        {selectedList?.sync_error && (
          <Callout intent={Intent.WARNING} title={t("filtering.syncError")} icon="warning-sign">
            {selectedList.sync_error}
          </Callout>
        )}

        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 break-all font-mono text-sm">
          {selectedList?.url}
        </div>

        <div className="flex items-center justify-between border border-gray-200 dark:border-gray-700 rounded-lg p-3">
          <div>
            <div className="text-sm font-bold">{t("filtering.listEnabled", "List active")}</div>
            <div className="text-xs opacity-60">
              {t("filtering.listEnabledHint", "Disable to stop filtering with this list without deleting it. Its subscription and sync history are kept.")}
            </div>
          </div>
          <Switch
            large
            checked={!!selectedList?.enabled}
            disabled={toggling}
            onChange={(e) => handleToggle((e.target as HTMLInputElement).checked)}
          />
        </div>

        <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-3">
          <div>
            <div className="text-sm font-bold">{t("filtering.checkDomain", "Check a domain")}</div>
            <div className="text-xs opacity-60">
              {t("filtering.checkDomainHint", "Lists are stored as compact filters, so their entries cannot be browsed. You can test any domain against this list instantly.")}
            </div>
          </div>

          <div className="flex gap-2">
            <InputGroup
              fill
              placeholder="example.com"
              value={query}
              disabled={checking}
              leftIcon="globe-network"
              onChange={(e) => {
                setQuery(e.target.value);
                // Drop the previous verdict so "Allow anyway" can never act on
                // a domain other than the one now in the field.
                setResult(null);
              }}
              onKeyDown={(e) => { if (e.key === "Enter") void runCheck(); }}
            />
            <Button
              icon={<Search size={14} />}
              text={t("filtering.check", "Check")}
              loading={checking}
              disabled={!query.trim()}
              onClick={() => void runCheck()}
            />
          </div>

          {error && <Callout intent={Intent.DANGER} className="text-xs">{error}</Callout>}

          {result && !result.synced && (
            <Callout intent={Intent.WARNING} className="text-xs">
              {t("filtering.checkNotSynced", "This list has not finished syncing yet, so there is nothing to check against.")}
            </Callout>
          )}

          {result?.synced && result.enabled === false && (
            <Callout intent={Intent.NONE} className="text-xs">
              {t("filtering.checkListDisabled", "This list is currently disabled, so it is not filtering anything right now.")}
            </Callout>
          )}

          {result?.synced && (
            <Callout
              intent={result.blocked ? Intent.WARNING : Intent.SUCCESS}
              className="text-xs"
              icon={result.blocked ? "ban-circle" : "tick-circle"}
            >
              {result.blocked ? (
                <div className="space-y-2">
                  <div>
                    {t("filtering.checkBlocked", "Blocked by this list")}
                    {result.matchedEntry && result.matchedEntry !== result.domain && (
                      <>
                        {" "}
                        <Tag minimal className="font-mono">{result.matchedEntry}</Tag>{" "}
                        {t("filtering.checkViaParent", "(matched a parent domain)")}
                      </>
                    )}
                  </div>
                  <div className="opacity-75">
                    {result.falsePositiveRate
                      ? t("filtering.checkProbabilisticRate", {
                          defaultValue:
                            "Filters are probabilistic: roughly 1 match in {{odds}} is a false positive. Adding an exception also covers every subdomain of it.",
                          odds: Math.round(1 / result.falsePositiveRate).toLocaleString(),
                        })
                      : t("filtering.checkProbabilistic", "Filters are probabilistic, so a small share of matches are false positives. Adding an exception also covers every subdomain of it.")}
                  </div>
                  {allowed ? (
                    <Tag intent={Intent.SUCCESS} minimal>
                      {t("filtering.checkAllowed", "Exception added - this domain now resolves")}
                    </Tag>
                  ) : (
                    <Button
                      small
                      icon={<ShieldOff size={12} />}
                      intent={Intent.PRIMARY}
                      loading={allowing}
                      text={t("filtering.checkAllowAction", "Allow anyway")}
                      onClick={() => void handleAllow()}
                    />
                  )}
                </div>
              ) : (
                t("filtering.checkNotBlocked", "Not blocked by this list")
              )}
            </Callout>
          )}
        </div>

        <div className="flex justify-between items-center">
          <span className="text-xs opacity-50">
            {t("filtering.tableLastSync")}:{" "}
            {selectedList?.last_synced_at
              ? formatDateTime(new Date(selectedList.last_synced_at * 1000))
              : "-"}
          </span>
          <div className="flex gap-2">
            <Button
              icon={<Copy size={14} />}
              text={t("setup.copyUrl", "Copy link")}
              onClick={() => { if (selectedList) onCopy(selectedList.url); }}
            />
            <Button
              icon={<ExternalLink size={14} />}
              text={t("setup.learnMore", "Open link")}
              onClick={() => { if (selectedList) window.open(selectedList.url, "_blank"); }}
            />
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-between">
        <Button
          icon={<Trash2 size={14} />}
          intent={Intent.DANGER}
          text={t("rules.delete", "Delete")}
          onClick={() => {
            if (!selectedList) return;
            // Deleting clears selectedList upstream, which closes the dialog by
            // prop without ever running onClose - so reset here, or the next
            // list opens showing the deleted list's verdict.
            const id = selectedList.id;
            reset();
            onDelete(id);
          }}
        />
        <Button onClick={() => { reset(); onClose(); }} text={t("rules.close", "Close")} />
      </div>
    </Dialog>
  );
};
