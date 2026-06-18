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
      const res = await fetch(`/api/profiles/${profileId}/lists`);
      const data = await res.json();
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
        const res = await fetch(`/api/profiles/${profileId}/lists`);
        if (res.ok) {
          const data = await res.json();
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
        }
      } catch (e) {
        // Ignore fetch errors during polling
      }
      attempts++;
    }
    
    await fetchData();
    return false;
  };

  const addList = async (urlToAdd?: string) => {
    const url = urlToAdd || newUrl;
    if (!url) return;
    setSyncing(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/lists`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        toasterRef?.current?.show({
          message: t("filtering.addSuccess"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
        setNewUrl("");

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
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const deleteList = async (id: number) => {
    try {
      const res = await fetch(`/api/profiles/${profileId}/lists`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        toasterRef?.current?.show({
          message: t("filtering.deleteSuccess"),
          intent: Intent.PRIMARY,
          icon: "trash",
        });
        setSelectedList(null);
        await fetchData();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const syncLists = async () => {
    setSyncing(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/lists/sync`, {
        method: "POST",
      });
      if (res.ok) {
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
    <div className={clsx("md:p-8 w-full min-w-0 max-w-5xl mx-auto", isMobile ? "p-1" : "p-8")}>
      <div className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="w-full md:w-auto flex-1">
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
          <p className="bp6-text-muted mt-2">{t("filtering.subtitle")}</p>
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
            "filtering.formatDisclaimer",
            "本系统只支持有限的 AdGuard 格式列表和纯域名列表。仅支持基础的拦截规则（如 ||example.com^），会绕过 \"@@\" 白名单，暂不支持 \"$\" 重写规则以及 \"*\" 省略规则。系统会自动匹配域名的所有子域名。"
          )}
        </p>
      </Callout>

      <AddListCard
        newUrl={newUrl}
        setNewUrl={setNewUrl}
        onAddList={addList}
        syncing={syncing}
        loading={loading}
        lists={lists}
      />

      <ListsTable lists={lists} onSelect={setSelectedList} />

      <ListDetailsDialog selectedList={selectedList} onClose={() => setSelectedList(null)} onCopy={copyToClipboard} onDelete={deleteList} />
    </div>
  );
};
