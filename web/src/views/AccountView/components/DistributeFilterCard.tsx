import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Elevation,
  H4,
  H5,
  FormGroup,
  InputGroup,
  Button,
  Intent,
  Callout,
  Tag,
  Divider,
  PopoverNext,
  type OverlayToaster
} from "@blueprintjs/core";
import { Send, CheckCircle2, AlertCircle, Filter, Undo2, ListFilter } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  distributeFilter,
  getPresetFilters,
  getDistributedFilters,
  revokeDistributedFilter,
  type DistributeFilterResponse,
  type DistributedFilterItem
} from "../../../services";

export interface DistributeFilterCardProps {
  toasterRef?: React.RefObject<OverlayToaster | null>;
  onSavingChange?: (saving: boolean) => void;
}

export const DistributeFilterCard: React.FC<DistributeFilterCardProps> = ({
  toasterRef,
  onSavingChange,
}) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [presets, setPresets] = useState<{ label: string; url: string }[]>([]);
  const [result, setResult] = useState<DistributeFilterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [distributed, setDistributed] = useState<DistributedFilterItem[]>([]);
  const [loadingDistributed, setLoadingDistributed] = useState(false);
  const [revokingUrl, setRevokingUrl] = useState<string | null>(null);
  const [revokeConfirmUrl, setRevokeConfirmUrl] = useState<string | null>(null);

  const fetchDistributed = useCallback(async () => {
    setLoadingDistributed(true);
    try {
      const items = await getDistributedFilters();
      setDistributed(items);
    } catch (e) {
      console.warn("Failed to fetch distributed filter lists", e);
    } finally {
      setLoadingDistributed(false);
    }
  }, []);

  useEffect(() => {
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
      .catch((e) => console.warn("Failed to fetch preset filters", e));

    fetchDistributed();
  }, [t, fetchDistributed]);

  const handleDistribute = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);
    setResult(null);
    onSavingChange?.(true);

    try {
      const res = await distributeFilter(trimmed);
      setResult(res);
      setUrl("");

      const toastMessage = res.failedCount > 0
        ? t(
            "admin.distributeFilter.toastPartialSuccess",
            "系统过滤列表已下发至 {{added}} 位用户，{{failed}} 位用户下发失败",
            { added: res.addedCount, failed: res.failedCount }
          )
        : t(
            "admin.distributeFilter.toastSuccess",
            "系统过滤列表已成功下发至 {{count}} 位用户",
            { count: res.addedCount }
          );

      toasterRef?.current?.show({
        message: toastMessage,
        intent: res.failedCount > 0 && res.addedCount === 0 ? Intent.DANGER : (res.failedCount > 0 ? Intent.WARNING : Intent.SUCCESS),
        icon: res.failedCount > 0 && res.addedCount === 0 ? "error" : "tick",
      });
      await fetchDistributed();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toasterRef?.current?.show({
        message: msg,
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setLoading(false);
      onSavingChange?.(false);
    }
  };

  const handleRevoke = async (targetUrl: string) => {
    setRevokingUrl(targetUrl);
    setRevokeConfirmUrl(null);
    onSavingChange?.(true);

    try {
      const res = await revokeDistributedFilter(targetUrl);
      toasterRef?.current?.show({
        message: t(
          "admin.distributeFilter.toastRevokeSuccess",
          "已成功撤回系统过滤列表，移除了 {{count}} 位用户的系统规则",
          { count: res.revokedCount }
        ),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      await fetchDistributed();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toasterRef?.current?.show({
        message: msg,
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setRevokingUrl(null);
      onSavingChange?.(false);
    }
  };

  return (
    <Card elevation={Elevation.ZERO} className="p-6 border border-gray-200 dark:border-gray-800 rounded-xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <H4 className="flex items-center space-x-2 text-base font-semibold">
            <Send className="w-5 h-5 text-indigo-500" />
            <span>{t("admin.distributeFilter.title", "系统过滤列表 (管理员)")}</span>
          </H4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t(
              "admin.distributeFilter.description",
              "向系统中所有用户账号下发制定系统级过滤列表。规则自动应用于用户的全部配置，带有“系统”标签。如果用户已存在相同规则则自动跳过。"
            )}
          </p>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center space-x-1">
            <Filter className="w-3.5 h-3.5" />
            <span>{t("admin.distributeFilter.quickPresets", "快捷预设")}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <Button
                key={preset.url}
                minimal
                small
                className="text-xs"
                intent={url === preset.url ? Intent.PRIMARY : Intent.NONE}
                onClick={() => setUrl(preset.url)}
              >
                {preset.label}
              </Button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <FormGroup
          label={t("admin.distributeFilter.urlLabel", "规则列表 URL")}
          labelFor="distribute-filter-url"
          helperText={t("admin.distributeFilter.urlHelper", "支持 AdGuard、Hosts、EasyList 等标准格式 URL")}
        >
          <div className="flex flex-col sm:flex-row gap-3">
            <InputGroup
              id="distribute-filter-url"
              fill
              placeholder="https://example.com/filter.txt"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={loading}
              className="font-mono text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !loading) {
                  handleDistribute();
                }
              }}
            />
            <Button
              intent={Intent.PRIMARY}
              icon={<Send className="w-4 h-4 mr-1" />}
              text={t("admin.distributeFilter.submitBtn", "立即下发")}
              loading={loading}
              disabled={!url.trim()}
              onClick={handleDistribute}
              className="shrink-0"
            />
          </div>
        </FormGroup>

        {error && (
          <Callout intent={Intent.DANGER} icon={null}>
            <H5 className="flex items-center gap-2 mb-2 font-semibold">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{t("common.error", "错误")}</span>
            </H5>
            <div className="text-sm">{error}</div>
          </Callout>
        )}

        {result && (
          <Callout
            intent={result.failedCount > 0 ? (result.addedCount > 0 ? Intent.WARNING : Intent.DANGER) : Intent.SUCCESS}
            icon={null}
          >
            <H5 className="flex items-center gap-2 mb-2 font-semibold">
              {result.failedCount > 0 && result.addedCount === 0 ? (
                <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-green-500" />
              )}
              <span>{t("admin.distributeFilter.resultTitle", "下发执行完成")}</span>
            </H5>
            <div className="space-y-2 text-sm">
              <p>
                {result.failedCount > 0
                  ? t(
                      "admin.distributeFilter.resultSummaryWithFailed",
                      "系统共 {{total}} 位用户：成功下发至 {{added}} 位用户，跳过 {{skipped}} 位已存在该规则的用户，{{failed}} 位用户下发失败。",
                      {
                        total: result.totalUsers,
                        added: result.addedCount,
                        skipped: result.skippedCount,
                        failed: result.failedCount,
                      }
                    )
                  : t(
                      "admin.distributeFilter.resultSummary",
                      "系统共 {{total}} 位用户：成功下发至 {{added}} 位用户，跳过 {{skipped}} 位已存在该规则的用户。",
                      {
                        total: result.totalUsers,
                        added: result.addedCount,
                        skipped: result.skippedCount,
                      }
                    )}
              </p>

              {result.addedUsernames.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs font-medium text-gray-500">
                    {t("admin.distributeFilter.addedUsers", "下发成功用户")}:
                  </span>
                  {result.addedUsernames.map((u) => (
                    <Tag key={u} intent={Intent.SUCCESS} minimal round>
                      {u}
                    </Tag>
                  ))}
                </div>
              )}

              {result.skippedUsernames.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs font-medium text-gray-500">
                    {t("admin.distributeFilter.skippedUsers", "已存在规则用户")}:
                  </span>
                  {result.skippedUsernames.map((u) => (
                    <Tag key={u} intent={Intent.NONE} minimal round>
                      {u}
                    </Tag>
                  ))}
                </div>
              )}

              {result.failedUsernames.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs font-medium text-red-500 dark:text-red-400">
                    {t("admin.distributeFilter.failedUsers", "下发失败用户")}:
                  </span>
                  {result.failedUsernames.map((u) => (
                    <Tag key={u} intent={Intent.DANGER} minimal round>
                      {u}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </Callout>
        )}
      </div>

      <Divider />

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold flex items-center space-x-2">
            <ListFilter className="w-4 h-4 text-indigo-500" />
            <span>{t("admin.distributeFilter.activeDistributedTitle", "已下发系统规则")}</span>
          </div>
          {distributed.length > 0 && (
            <Tag minimal round intent={Intent.PRIMARY}>
              {distributed.length}
            </Tag>
          )}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(
            "admin.distributeFilter.activeDistributedDesc",
            "当前处于系统下发状态且带有“系统”标签的规则列表。撤回后将从所有用户账号中移除此系统规则，用户自建的同名规则不受影响。"
          )}
        </p>

        {loadingDistributed ? (
          <div className="text-xs text-gray-400 py-3 text-center">
            {t("common.loading", "加载中...")}
          </div>
        ) : distributed.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-gray-500 py-4 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-center border border-dashed border-gray-200 dark:border-gray-700">
            {t("admin.distributeFilter.noDistributedFilters", "当前系统中无已下发的系统过滤列表")}
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
            {distributed.map((item) => (
              <div
                key={item.url}
                className="p-3 bg-white dark:bg-gray-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="font-mono text-xs text-gray-800 dark:text-gray-200 truncate select-all" title={item.url}>
                    {item.url}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                    <Tag minimal round intent={Intent.PRIMARY}>
                      {t("admin.distributeFilter.usersCount", "{{count}} 位用户", { count: item.userCount })}
                    </Tag>
                    {item.usernames.length > 0 && (
                      <span className="text-xs text-gray-400 truncate max-w-xs">
                        ({item.usernames.join(", ")})
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  <PopoverNext
                    isOpen={revokeConfirmUrl === item.url}
                    onInteraction={(nextOpen) => setRevokeConfirmUrl(nextOpen ? item.url : null)}
                    placement="top-end"
                    portalClassName="z-20000"
                    content={
                      <div className="p-3 space-y-3 max-w-xs">
                        <p className="text-xs font-semibold leading-relaxed m-0 text-gray-800 dark:text-gray-200">
                          {t(
                            "admin.distributeFilter.revokeConfirm",
                            "确定撤回此系统过滤列表？系统将从所有用户账号中移除此系统规则，用户自建的同名规则不受影响。"
                          )}
                        </p>
                        <div className="flex justify-end gap-2">
                          <Button
                            small
                            variant="minimal"
                            text={t("common.cancel", "取消")}
                            onClick={() => setRevokeConfirmUrl(null)}
                          />
                          <Button
                            small
                            intent={Intent.DANGER}
                            loading={revokingUrl === item.url}
                            text={t("admin.distributeFilter.confirmRevoke", "确认撤回")}
                            onClick={() => handleRevoke(item.url)}
                          />
                        </div>
                      </div>
                    }
                  >
                    <Button
                      small
                      intent={Intent.DANGER}
                      minimal
                      icon={<Undo2 className="w-3.5 h-3.5" />}
                      text={t("admin.distributeFilter.revokeBtn", "撤回")}
                      loading={revokingUrl === item.url}
                      onClick={() => setRevokeConfirmUrl(item.url)}
                    />
                  </PopoverNext>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
};
