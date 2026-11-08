import React, { useState, useEffect } from "react";
import { Button, Intent, Callout, ButtonGroup } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "../../hooks/useIsMobile";
import { clsx } from "clsx";

import type {  FilteringViewProps, FilterList  } from "./types";
import { AddListCard } from "./components/AddListCard";
import { ListsTable } from "./components/ListsTable";
import { ListDetailsDialog } from "./components/ListDetailsDialog";
import { getProfileLists, addCustomProfileList, deleteCustomProfileList, syncProfileLists, syncSingleProfileList, toggleProfileList, addProfileRule } from "../../services";

export const FilteringView: React.FC<FilteringViewProps> = ({ profileId, toasterRef }) => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [lists, setLists] = useState<FilterList[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { t } = useTranslation();

  const [selectedList, setSelectedList] = useState<FilterList | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const data = await getProfileLists(profileId);
      setLists(data);
    } catch (e) {
      console.error("Failed to fetch filters", e);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toasterRef?.current?.show({
      message: t("setup.copied", "已复制到剪贴板"),
      intent: Intent.SUCCESS,
      icon: "duplicate",
    });
  };

  const waitForSyncCompletion = async (oldLists: FilterList[]) => {
    const oldSyncTimes = new Map(oldLists.map(l => [l.id, l.last_synced_at]));
    let attempts = 0;
    const maxAttempts = 15; // 30 seconds max
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        const data = await getProfileLists(profileId);
        const newLists = data as FilterList[];
        
        let allUpdated = true;
        for (const list of newLists) {
          if (oldSyncTimes.has(list.id) && list.last_synced_at === oldSyncTimes.get(list.id)) {
            allUpdated = false;
            break;
          }
          if (!oldSyncTimes.has(list.id) && !list.last_synced_at) {
            allUpdated = false;
            break;
          }
        }
        
        if (allUpdated && newLists.length > 0) {
          setLists(newLists);
          return true;
        }
      } catch (e) {
        // Ignore fetch errors during polling
      }
      attempts++;
    }
    
    await fetchData();
    return false;
  };

  const waitForSingleSyncCompletion = async (listId: number, oldSyncTime?: number | null) => {
    let attempts = 0;
    const maxAttempts = 15; // 30 seconds max
    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        const data = await getProfileLists(profileId);
        const newLists = data as FilterList[];
        const current = newLists.find((l) => l.id === listId);
        if (current && (current.last_synced_at ?? 0) !== (oldSyncTime ?? 0)) {
          setLists(newLists);
          setSelectedList(current);
          return true;
        }
      } catch (e) {
        // Ignore fetch errors during polling
      }
      attempts++;
    }
    await fetchData();
    return false;
  };

  const handleSyncSingleList = async (listId: number) => {
    try {
      const oldList = lists.find((l) => l.id === listId);
      const oldSyncTime = oldList?.last_synced_at;
      await syncSingleProfileList(profileId, listId);
      toasterRef?.current?.show({
        message: t("filtering.singleSyncStarted", "列表同步任务已开始"),
        intent: Intent.PRIMARY,
        icon: "cloud-download",
      });
      const completed = await waitForSingleSyncCompletion(listId, oldSyncTime);
      if (completed) {
        toasterRef?.current?.show({
          message: t("filtering.syncCheckComplete"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
      }
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: e instanceof Error ? e.message : String(e),
        intent: Intent.DANGER,
        icon: "error",
      });
    }
  };

  const addList = async (urlToAdd?: string) => {
    const url = urlToAdd || newUrl;
    if (!url) return;
    setSyncing(true);
    try {
      const result = await addCustomProfileList(profileId, url);
      toasterRef?.current?.show({
        message: t("filtering.addSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      setNewUrl("");

      toasterRef?.current?.show({
        message: t("filtering.singleSyncStarted", "列表同步任务已开始"),
        intent: Intent.PRIMARY,
        icon: "cloud-download",
      });

      let targetId = result?.id;
      if (!targetId) {
        const fresh = await getProfileLists(profileId);
        const created = fresh.find((l) => l.url.trim().toLowerCase() === url.trim().toLowerCase());
        targetId = created?.id;
        setLists(fresh);
      }

      if (targetId) {
        const completed = await waitForSingleSyncCompletion(targetId, 0);
        if (completed) {
          toasterRef?.current?.show({
            message: t("filtering.syncCheckComplete"),
            intent: Intent.SUCCESS,
            icon: "tick",
          });
        }
      } else {
        await fetchData();
      }
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: e instanceof Error ? e.message : String(e),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setSyncing(false);
    }
  };

  /**
   * Enables or disables a list. The worker rebuilds the merged profile bloom
   * from the lists still active, so filtering reflects the change without a
   * re-download.
   */
  const setListEnabled = async (id: number, enabled: boolean) => {
    try {
      await toggleProfileList(profileId, id, enabled);
      toasterRef?.current?.show({
        message: enabled
          ? t("filtering.listEnabledToast", "List enabled - rebuilding filter")
          : t("filtering.listDisabledToast", "List disabled - rebuilding filter"),
        intent: Intent.PRIMARY,
        icon: enabled ? "tick" : "disable",
      });
      const fresh = await getProfileLists(profileId);
      setLists(fresh);
      if (selectedList) {
        const updatedCurrent = fresh.find((l) => l.id === id || l.url === selectedList.url);
        if (updatedCurrent) setSelectedList(updatedCurrent);
      }
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: e instanceof Error ? e.message : String(e),
        intent: Intent.DANGER,
        icon: "error",
      });
    }
  };

  /**
   * Adds an ALLOW rule for a domain an external list blocks. The resolver
   * checks the allow list before consulting the bloom filter, so the exception
   * wins - and because rules live outside lists, it survives the next sync.
   */
  const allowDomain = async (domain: string) => {
    await addProfileRule(profileId, { type: "ALLOW", pattern: domain });
    toasterRef?.current?.show({
      message: t("filtering.allowRuleAdded", "Exception added for {{domain}}", { domain }),
      intent: Intent.SUCCESS,
      icon: "tick",
    });
  };

  const deleteList = async (id: number) => {
    try {
      await deleteCustomProfileList(profileId, id);
      toasterRef?.current?.show({
        message: t("filtering.deleteSuccess"),
        intent: Intent.PRIMARY,
        icon: "trash",
      });
      setSelectedList(null);
      await fetchData();
    } catch (e) {
      console.error(e);
    }
  };

  const syncLists = async () => {
    setSyncing(true);
    try {
      await syncProfileLists(profileId);
      toasterRef?.current?.show({
        message: t("filtering.syncTaskStarted"),
        intent: Intent.PRIMARY,
        icon: "cloud-download",
      });
      
      const completed = await waitForSyncCompletion(lists);
      if (completed) {
        toasterRef?.current?.show({
          message: t("filtering.syncCheckComplete"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [profileId]);

  return (
    <div className={clsx("md:px-8 w-full min-w-0 max-w-5xl mx-auto", isMobile ? "p-1" : "px-8")}>
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="w-full md:w-auto flex-1">
          {isMobile ? (
            <ButtonGroup minimal fill={isMobile}>
              <Button
                active={false}
                onClick={() => navigate(`/dash/${profileId}/rules`)}
                text={t("rules.title")}
                large
              />
              <Button
                active={true}
                onClick={() => navigate(`/dash/${profileId}/filter`)}
                text={t("filtering.title")}
                large
              />
            </ButtonGroup>
          ) : (
            <h1 className="bp6-heading">{t("filtering.title")}</h1>
          )}
          <p className="bp6-text-muted mt-2!">{t("filtering.subtitle")}</p>
        </div>
        <Button
          icon={<RefreshCw size={16} />}
          text={t("filtering.syncAll")}
          onClick={syncLists}
          loading={syncing || loading}
          disabled={syncing || loading || lists.length === 0}
          className={isMobile ? "w-full" : ""}
        />
      </div>

      <Callout intent={Intent.WARNING} icon="info-sign" className="mb-6">
        <p>
          {t(
            "filtering.formatDisclaimer"
          )}
        </p>
      </Callout>

      {/* ── Profile 级列表 (上方) ── */}
      <AddListCard
        newUrl={newUrl}
        setNewUrl={setNewUrl}
        onAddList={addList}
        syncing={syncing}
        loading={loading}
        lists={lists}
      />

      <div className="mb-6">
        <ListsTable
          lists={lists.filter((l) => l.scope === "profile")}
          onSelect={setSelectedList}
          loading={loading}
          emptyTitle={t("filtering.noProfileListsTitle", "尚未添加配置级列表")}
          emptyDesc={t("filtering.noProfileListsDesc", "您可在此为当前配置添加专属的拦截列表。")}
        />
      </div>

      {/* ── 分割线 ── */}
      <div className="border-t border-gray-200 dark:border-gray-800 my-8 pt-6">
        <div className="mb-4">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <span>{t("filtering.userAndSystemListsTitle", "用户级与系统级列表")}</span>
            <span className="text-xs font-normal text-gray-400">
              ({lists.filter((l) => l.scope !== "profile").length})
            </span>
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t(
              "filtering.userAndSystemListsSubtitle",
              "继承自账号设置或由系统下发的全局规则列表，自动应用于所有配置。可在此处针对当前配置停用，但不可在此删除。"
            )}
          </p>
        </div>

        <ListsTable
          lists={lists.filter((l) => l.scope !== "profile")}
          onSelect={setSelectedList}
          loading={loading}
          emptyTitle={t("filtering.noUserSystemListsTitle", "暂无用户级与系统级列表")}
          emptyDesc={t("filtering.noUserSystemListsDesc", "可在账号设置页面中添加应用于所有配置的用户级规则。")}
        />
      </div>

      <ListDetailsDialog
        profileId={profileId}
        selectedList={selectedList}
        onClose={() => setSelectedList(null)}
        onCopy={copyToClipboard}
        onDelete={deleteList}
        onToggleEnabled={setListEnabled}
        onAllowDomain={allowDomain}
        onSyncSingle={handleSyncSingleList}
      />
    </div>
  );
};
