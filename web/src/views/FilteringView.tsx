import React, { useState, useEffect, useMemo } from "react";
import {
  Button,
  Card,
  Elevation,
  InputGroup,
  Intent,
  HTMLTable,
  Tag,
  Menu,
  MenuItem,
  Popover,
  Position,
  OverlayToaster,
  Dialog,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Trash2, RefreshCw, Copy, ExternalLink } from "lucide-react";
import { formatDateTime } from "../utils/date";

interface FilteringViewProps {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export const FilteringView: React.FC<FilteringViewProps> = ({
  profileId,
  toasterRef,
}) => {
  const [lists, setLists] = useState<any[]>([]);
  const [newUrl, setNewUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { t } = useTranslation();

  // 详情弹窗状态
  const [selectedList, setSelectedList] = useState<any | null>(null);

  const PRESET_LISTS = useMemo(
    () => [
      { label: t("filtering.presetOisdBig"), url: "https://big.oisd.nl" },
      { label: t("filtering.presetOisdNsfw"), url: "https://nsfw.oisd.nl" },
      {
        label: t("filtering.presetAdGuard"),
        url: "https://adguardteam.github.io/AdguardFilters/BaseFilter/sections/adservers.txt",
      },
      {
        label: t("filtering.presetStevenBlack"),
        url: "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts",
      },
    ],
    [t],
  );

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

  const presetMenu = (
    <Menu className="min-w-96">
      {PRESET_LISTS.map((preset, i) => (
        <MenuItem
          key={i}
          text={preset.label}
          onClick={() => addList(preset.url)}
          disabled={lists.some((l) => l.url === preset.url)}
          labelElement={
            <div className="flex flex-col items-end text-right">
              <span
                className="text-[9px] opacity-85 max-w-xl truncate"
                title={preset.url}
              >
                {preset.url}
              </span>
            </div>
          }
        />
      ))}
    </Menu>
  );

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

      <Card elevation={Elevation.ONE} className="mb-6">
        <div className="flex gap-2 flex-col sm:flex-row">
          <InputGroup
            fill
            size="large"
            placeholder={t("filtering.urlPlaceholder")}
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            leftIcon="globe"
            rightElement={
              <Popover
                content={presetMenu}
                position={Position.BOTTOM_RIGHT}
                minimal={true}
                usePortal={true}
              >
                <Button variant="minimal" icon="chevron-down" />
              </Popover>
            }
          />
          <Button
            intent={Intent.PRIMARY}
            size="large"
            icon="plus"
            onClick={() => addList()}
            className="shrink-0"
            loading={syncing || loading}
            disabled={syncing || loading}
          >
            {t("filtering.addSubscription")}
          </Button>
        </div>
      </Card>

      <HTMLTable interactive striped className="w-full">
        <thead>
          <tr>
            <th>{t("filtering.tableUrl")}</th>
            <th>{t("filtering.tableLastSync")}</th>
            <th>{t("filtering.tableStatus")}</th>
            <th className="text-right">{t("filtering.tableOps")}</th>
          </tr>
        </thead>
        <tbody>
          {lists.map((list) => (
            <tr
              key={list.id}
              onClick={() => setSelectedList(list)}
              className="cursor-pointer"
            >
              <td className="font-mono text-sm max-w-md truncate">
                {list.url}
              </td>
              <td className="text-xs opacity-60">
                {list.last_synced_at
                  ? formatDateTime(new Date(list.last_synced_at * 1000))
                  : t("filtering.neverSynced")}
              </td>
              <td>
                <Tag
                  intent={list.enabled ? Intent.SUCCESS : Intent.NONE}
                  minimal
                >
                  {list.enabled
                    ? t("filtering.enabled")
                    : t("filtering.disabled")}
                </Tag>
              </td>
              <td className="text-right" onClick={(e) => e.stopPropagation()}>
                <Button
                  icon={<Trash2 size={14} />}
                  variant="minimal"
                  intent={Intent.DANGER}
                  onClick={() => deleteList(list.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </HTMLTable>

      <Dialog
        isOpen={selectedList !== null}
        onClose={() => setSelectedList(null)}
        title={t("filtering.listDetails", "List Details")}
        icon="info-sign"
      >
        <div className="p-6 space-y-4">
          <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 break-all font-mono text-sm">
            {selectedList?.url}
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
                text={t("setup.copyUrl", "复制链接")}
                onClick={() => copyToClipboard(selectedList?.url)}
              />
              <Button
                icon={<ExternalLink size={14} />}
                text={t("setup.learnMore", "访问链接")}
                onClick={() => window.open(selectedList?.url, "_blank")}
              />
            </div>
          </div>
        </div>
      </Dialog>
    </div>
  );
};
