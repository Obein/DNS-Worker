import React, { useState, useEffect } from "react";
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
  type OverlayToaster
} from "@blueprintjs/core";
import { Send, CheckCircle2, AlertCircle, Filter } from "lucide-react";
import { useTranslation } from "react-i18next";

import { distributeFilter, getPresetFilters, type DistributeFilterResponse } from "../../../services";

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
  }, [t]);

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
      toasterRef?.current?.show({
        message: t(
          "admin.distributeFilter.toastSuccess",
          "过滤器已成功下发至 {{count}} 位用户",
          { count: res.addedCount }
        ),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
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

  return (
    <Card elevation={Elevation.ZERO} className="p-6 border border-gray-200 dark:border-gray-800 rounded-xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <H4 className="flex items-center space-x-2 text-base font-semibold">
            <Send className="w-5 h-5 text-indigo-500" />
            <span>{t("admin.distributeFilter.title", "下发过滤器 (管理员)")}</span>
          </H4>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {t(
              "admin.distributeFilter.description",
              "向系统中所有用户的配置下发指定过滤规则列表。如果用户已存在相同规则则自动跳过。用户可自行删除已下发的过滤器。"
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
          <Callout intent={Intent.SUCCESS} icon={null}>
            <H5 className="flex items-center gap-2 mb-2 font-semibold">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{t("admin.distributeFilter.resultTitle", "下发执行完成")}</span>
            </H5>
            <div className="space-y-2 text-sm">
              <p>
                {t(
                  "admin.distributeFilter.resultSummary",
                  "系统共 {{total}} 位用户：成功下发至 {{added}} 位用户（{{profiles}} 个配置），跳过 {{skipped}} 位已存在该规则的用户。",
                  {
                    total: result.totalUsers,
                    added: result.addedCount,
                    profiles: result.affectedProfilesCount,
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
                    {t("admin.distributeFilter.skippedUsers", "自动跳过用户")}:
                  </span>
                  {result.skippedUsernames.map((u) => (
                    <Tag key={u} intent={Intent.NONE} minimal round>
                      {u}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
          </Callout>
        )}
      </div>
    </Card>
  );
};
