import React, { useState, useRef } from "react";
import { Dialog, Button, Intent, Callout, Switch, InputGroup, Tag, PopoverNext } from "@blueprintjs/core";
import { Copy, ExternalLink, Trash2, Search, ShieldOff, RefreshCw } from "lucide-react";
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
  /** Triggers manual sync for this single list */
  onSyncSingle?: (id: number) => Promise<void>;
}

export const ListDetailsDialog: React.FC<ListDetailsDialogProps> = ({
  profileId,
  selectedList,
  onClose,
  onCopy,
  onDelete,
  onToggleEnabled,
  onAllowDomain,
  onSyncSingle,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<ListCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allowing, setAllowing] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [syncingSingle, setSyncingSingle] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
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
    setDeleteConfirmOpen(false);
  };

  const runCheck = async () => {
    let domain = query.trim().toLowerCase();
    if (!domain || !selectedList) return;

    // Clean user input: strip protocol (http:// or https://), path, port, and trailing dots
    domain = domain.replace(/^https?:\/\//, '').split('/')[0].split(':')[0].replace(/\.+$/, '');
    if (!domain) return;
    setQuery(domain);

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

  const handleSync = async () => {
    if (!selectedList || !onSyncSingle) return;
    setSyncingSingle(true);
    try {
      await onSyncSingle(selectedList.id);
    } finally {
      setSyncingSingle(false);
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

        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 break-all font-mono text-sm flex items-center justify-between gap-2">
          <span>{selectedList?.url}</span>
          {Boolean(selectedList?.is_system) && (
            <Tag intent={Intent.PRIMARY} minimal className="shrink-0 font-sans">
              {t("filtering.systemDistributed", "系统下发")}
            </Tag>
          )}
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

          <div className="flex gap-2 items-center">
            <InputGroup
              fill
              className="flex-1 min-w-0"
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
              className="shrink-0 whitespace-nowrap min-w-fit w-auto"
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
                        {result.matchedEntry.includes("*") || result.matchedEntry.startsWith("/")
                          ? t("filtering.checkViaPattern", "(匹配到通配规则)")
                          : t("filtering.checkViaParent", "(matched a parent domain)")}
                      </>
                    )}
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
              ) : result.whitelisted ? (
                <div className="space-y-1">
                  <div className="font-medium text-emerald-700 dark:text-emerald-400">
                    {t("filtering.checkWhitelisted", "被该列表放行")}
                    {result.matchedEntry && (
                      <>
                        {" "}
                        <Tag minimal intent={Intent.SUCCESS} className="font-mono">{result.matchedEntry}</Tag>
                      </>
                    )}
                  </div>
                  <div className="opacity-75">
                    {t("filtering.checkWhitelistedDesc", "命中该订阅列表中的白名单/例外规则 (@@)，即使被其他黑名单规则命中也会优先放行。")}
                  </div>
                </div>
              ) : (
                t("filtering.checkNotBlocked", "Not blocked by this list")
              )}
            </Callout>
          )}
        </div>

        <div className="flex justify-between items-center gap-3">
          <span className="text-xs opacity-50 truncate min-w-0">
            {t("filtering.tableLastSync")}:{" "}
            {selectedList?.last_synced_at
              ? formatDateTime(new Date(selectedList.last_synced_at * 1000))
              : "-"}
          </span>
          <div className="flex gap-2 shrink-0">
            <Button
              className="shrink-0 whitespace-nowrap min-w-fit w-auto"
              icon={<Copy size={14} />}
              text={t("setup.copyUrl", "Copy link")}
              onClick={() => { if (selectedList) onCopy(selectedList.url); }}
            />
            <Button
              className="shrink-0 whitespace-nowrap min-w-fit w-auto"
              icon={<ExternalLink size={14} />}
              text={t("setup.learnMore", "Open link")}
              onClick={() => { if (selectedList) window.open(selectedList.url, "_blank"); }}
            />
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-gray-100 dark:border-gray-800 flex justify-between items-center">
        <PopoverNext
          isOpen={deleteConfirmOpen}
          onInteraction={setDeleteConfirmOpen}
          placement="top-start"
          portalClassName="z-20000"
          content={
            <div className="p-3 space-y-3 max-w-xs">
              <p className="text-xs font-semibold leading-relaxed m-0 text-gray-800 dark:text-gray-200">
                {t("filtering.deleteConfirm", "Are you sure you want to delete this list? This action cannot be undone.")}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  small
                  variant="minimal"
                  text={t("common.cancel", "Cancel")}
                  onClick={() => setDeleteConfirmOpen(false)}
                />
                <Button
                  small
                  intent={Intent.DANGER}
                  text={t("common.confirm", "Confirm")}
                  onClick={() => {
                    if (!selectedList) return;
                    const id = selectedList.id;
                    setDeleteConfirmOpen(false);
                    reset();
                    onDelete(id);
                  }}
                />
              </div>
            </div>
          }
        >
          <Button
            icon={<Trash2 size={14} />}
            intent={Intent.DANGER}
            text={t("rules.delete", "Delete")}
            onClick={() => setDeleteConfirmOpen(true)}
          />
        </PopoverNext>
        <div className="flex gap-2">
          {onSyncSingle && (
            <Button
              icon={<RefreshCw size={14} className={syncingSingle ? "animate-spin" : ""} />}
              intent={Intent.PRIMARY}
              loading={syncingSingle}
              disabled={syncingSingle}
              text={t("filtering.syncSingle", "同步此列表")}
              onClick={() => void handleSync()}
            />
          )}
          <Button onClick={() => { reset(); onClose(); }} text={t("rules.close", "Close")} />
        </div>
      </div>
    </Dialog>
  );
};
