import React, { useState, useEffect } from "react";
import { Button, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

import type {  FilteringViewProps, FilterList  } from "./types";
import { AddListCard } from "./components/AddListCard";
import { ListsTable } from "./components/ListsTable";
import { ListDetailsDialog } from "./components/ListDetailsDialog";

export const FilteringView: React.FC<FilteringViewProps> = ({ profileId, toasterRef }) => {
  const [lists, setLists] = useState<FilterList[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { t } = useTranslation();

  const [selectedList, setSelectedList] = useState<FilterList | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/filters`);
      const data = await res.json();
      setLists(data.lists);
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

        // Show sync started message and wait briefly for the backend sync to complete
        toasterRef?.current?.show({
          message: t("filtering.syncTaskStarted"),
          intent: Intent.PRIMARY,
          icon: "cloud-download",
        });
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await fetchData();
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
        await new Promise((resolve) => setTimeout(resolve, 3000));
        await fetchData();
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
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8 flex justify-between items-end">
        <div>
          <h2 className="bp6-heading">{t("filtering.title")}</h2>
          <p className="bp6-text-muted">{t("filtering.subtitle")}</p>
        </div>
        <Button
          icon={<RefreshCw size={16} />}
          text={t("filtering.syncAll")}
          onClick={syncLists}
          loading={syncing || loading}
          disabled={syncing || loading || lists.length === 0}
        />
      </div>

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
