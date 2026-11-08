import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Elevation,
  H4,
  FormGroup,
  InputGroup,
  Button,
  Intent,
  Callout,
  Tag,
  Switch,
  PopoverNext,
  HTMLTable,
  Spinner,
  type OverlayToaster,
} from "@blueprintjs/core";
import { ListFilter, Plus, Trash2, Shield, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  getUserLists,
  addUserList,
  toggleUserList,
  deleteUserList,
  getPresetFilters,
  type UserList,
} from "../../../services";
import { formatDateTime } from "../../../utils/date";

export interface UserFilterListsCardProps {
  toasterRef?: React.RefObject<OverlayToaster | null>;
  onSavingChange?: (saving: boolean) => void;
}

export const UserFilterListsCard: React.FC<UserFilterListsCardProps> = ({
  toasterRef,
  onSavingChange,
}) => {
  const { t } = useTranslation();
  const [lists, setLists] = useState<UserList[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [presets, setPresets] = useState<{ label: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);

  const fetchLists = useCallback(async () => {
    try {
      const data = await getUserLists();
      setLists(data);
    } catch (e) {
      console.warn("Failed to fetch user lists", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLists();
    getPresetFilters()
      .then((config) => {
        if (config && Array.isArray(config)) {
          setPresets(
            config.map((item: any) => ({
              label: String(t(item.label, { defaultValue: item.label })),
              url: String(item.url || ""),
            }))
          );
        }
      })
      .catch((e) => console.warn("Failed to fetch presets", e));
  }, [fetchLists, t]);

  const handleAdd = async () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    setAdding(true);
    setError(null);
    onSavingChange?.(true);

    try {
      await addUserList(trimmed);
      setNewUrl("");
      toasterRef?.current?.show({
        message: t("account.userFilterLists.addSuccess", "用户级过滤规则已成功添加并应用于所有配置"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      await fetchLists();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toasterRef?.current?.show({
        message: msg,
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setAdding(false);
      onSavingChange?.(false);
    }
  };

  const handleToggle = async (id: number, enabled: boolean) => {
    try {
      await toggleUserList(id, enabled);
      setLists((prev) => prev.map((l) => (l.id === id ? { ...l, enabled } : l)));
      toasterRef?.current?.show({
        message: enabled
          ? t("account.userFilterLists.enabledToast", "规则已在账号全局启用")
          : t("account.userFilterLists.disabledToast", "规则已在账号全局停用"),
        intent: Intent.PRIMARY,
        icon: enabled ? "tick" : "disable",
      });
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: e instanceof Error ? e.message : String(e),
        intent: Intent.DANGER,
        icon: "error",
      });
      await fetchLists();
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteUserList(id);
      setDeleteConfirmId(null);
      setLists((prev) => prev.filter((l) => l.id !== id));
      toasterRef?.current?.show({
        message: t("account.userFilterLists.deleteSuccess", "已删除用户级规则"),
        intent: Intent.PRIMARY,
        icon: "trash",
      });
    } catch (e) {
      console.error(e);
      toasterRef?.current?.show({
        message: e instanceof Error ? e.message : String(e),
        intent: Intent.DANGER,
        icon: "error",
      });
    }
  };

  return (
    <Card elevation={Elevation.ZERO} className="p-6 border border-gray-100 dark:border-gray-800 rounded-xl space-y-6">
      <div>
        <H4 className="flex items-center gap-2 mb-1 font-semibold text-gray-900 dark:text-gray-100">
          <ListFilter className="w-5 h-5 text-indigo-500 shrink-0" />
          <span>{t("account.userFilterLists.title", "用户级过滤列表")}</span>
        </H4>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t(
            "account.userFilterLists.description",
            "在此配置的过滤规则列表将自动应用于您的所有配置 (Profiles)。系统级规则带有“系统”标签，自建规则带有“用户”标签。"
          )}
        </p>
      </div>

      {error && (
        <Callout intent={Intent.DANGER} icon="error" className="text-sm">
          <div className="flex justify-between items-center">
            <span>{error}</span>
            <Button minimal small icon="cross" onClick={() => setError(null)} />
          </div>
        </Callout>
      )}

      {/* URL Input Form */}
      <div className="space-y-4">
        {presets.length > 0 && (
          <div>
            <span className="text-xs font-medium text-gray-500 mb-2 block">
              {t("account.userFilterLists.quickPresets", "快捷预设")}
            </span>
            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Tag
                  key={preset.url}
                  interactive
                  minimal
                  round
                  className="cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() => setNewUrl(preset.url)}
                >
                  {preset.label}
                </Tag>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2">
          <FormGroup
            className="mb-0 flex-1"
            helperText={t("account.userFilterLists.urlHelper", "支持 AdGuard、Hosts、EasyList 等标准格式 URL")}
          >
            <InputGroup
              leftIcon="globe"
              placeholder="https://example.com/filters.txt"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              disabled={adding}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAdd();
              }}
            />
          </FormGroup>

          <Button
            intent={Intent.PRIMARY}
            icon={<Plus size={16} />}
            text={t("account.userFilterLists.addBtn", "添加列表")}
            onClick={() => void handleAdd()}
            loading={adding}
            disabled={!newUrl.trim() || adding}
            className="self-start sm:mt-0"
          />
        </div>
      </div>

      {/* User Lists Table */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
            {t("account.userFilterLists.activeListsTitle", "生效列表清单")}
          </span>
          <Button
            icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
            minimal
            small
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void fetchLists();
            }}
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
            <Spinner size={16} />
            <span className="text-sm">{t("common.loading", "加载中...")}</span>
          </div>
        ) : lists.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm border border-dashed border-gray-200 dark:border-gray-800 rounded-lg">
            {t("account.userFilterLists.empty", "暂无用户级与系统级过滤列表。您可在上方添加自建列表。")}
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-800 rounded-lg">
            <HTMLTable interactive striped className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr>
                  <th className="py-2.5 px-3 text-left font-semibold whitespace-nowrap">{t("account.userFilterLists.colUrl", "列表 URL")}</th>
                  <th className="py-2.5 px-3 text-left font-semibold w-24 whitespace-nowrap">{t("account.userFilterLists.colType", "类型")}</th>
                  <th className="py-2.5 px-3 text-left font-semibold w-36 whitespace-nowrap">{t("account.userFilterLists.colLastSync", "最近同步")}</th>
                  <th className="py-2.5 px-3 text-center font-semibold w-24 whitespace-nowrap">{t("account.userFilterLists.colStatus", "状态")}</th>
                  <th className="py-2.5 px-3 text-right font-semibold w-20 whitespace-nowrap">{t("account.userFilterLists.colActions", "操作")}</th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 px-3 font-mono text-xs max-w-xs sm:max-w-md truncate" title={l.url}>
                      {l.url}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {l.is_system === 1 ? (
                        <Tag intent={Intent.PRIMARY} minimal round className="text-xs font-sans whitespace-nowrap">
                          {t("filtering.tagSystem", "系统")}
                        </Tag>
                      ) : (
                        <Tag intent={Intent.SUCCESS} minimal round className="text-xs font-sans whitespace-nowrap">
                          {t("filtering.tagUser", "用户")}
                        </Tag>
                      )}
                    </td>
                    <td className="py-2 px-3 text-xs opacity-70 whitespace-nowrap">
                      {l.last_synced_at ? formatDateTime(new Date(l.last_synced_at * 1000)) : t("filtering.neverSynced", "未同步")}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap">
                      <Switch
                        checked={l.enabled}
                        onChange={(e) => void handleToggle(l.id, (e.target as HTMLInputElement).checked)}
                        className="mb-0 inline-block"
                        innerLabelChecked={t("common.yes", "开")}
                        innerLabel={t("common.no", "关")}
                      />
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {l.is_system === 0 ? (
                        <PopoverNext
                          isOpen={deleteConfirmId === l.id}
                          onInteraction={(open) => setDeleteConfirmId(open ? l.id : null)}
                          placement="top-end"
                          content={
                            <div className="p-3 space-y-3 max-w-xs">
                              <p className="text-xs font-semibold leading-relaxed m-0 text-gray-800 dark:text-gray-200">
                                {t("account.userFilterLists.deleteConfirm", "确定从账号中删除此过滤列表吗？该规则将从您的所有配置中移除。")}
                              </p>
                              <div className="flex justify-end gap-2">
                                <Button
                                  small
                                  variant="minimal"
                                  text={t("common.cancel", "取消")}
                                  onClick={() => setDeleteConfirmId(null)}
                                />
                                <Button
                                  small
                                  intent={Intent.DANGER}
                                  text={t("common.confirm", "确认删除")}
                                  onClick={() => void handleDelete(l.id)}
                                />
                              </div>
                            </div>
                          }
                        >
                          <Button icon={<Trash2 size={14} />} minimal intent={Intent.DANGER} small />
                        </PopoverNext>
                      ) : (
                        <Tag intent={Intent.NONE} minimal round className="text-xs text-gray-400">
                          <Shield size={10} className="inline mr-1" />
                          {t("account.userFilterLists.systemManaged", "统一维护")}
                        </Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
        )}
      </div>
    </Card>
  );
};
