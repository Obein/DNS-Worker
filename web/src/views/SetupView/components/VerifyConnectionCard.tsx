import React, { useState, useMemo } from "react";
import { Section, SectionCard, Button, Spinner, Intent, PopoverNext } from "@blueprintjs/core";
import { Activity, ShieldCheck, Server, Globe, MapPin, Eye, EyeOff, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import type { ClientInfo } from "../types";
import { useDeploymentMode } from "../../../hooks/useDeploymentMode";

export interface VerifyConnectionCardProps {
  isVerifying: boolean;
  verifyResult: { success: boolean; profileMatch: boolean } | null;
  handleVerify: () => void;
  isMobile: boolean;
  clientInfo: ClientInfo | null;
  showIp: boolean;
  setShowIp: (show: boolean) => void;
  showLocation: boolean;
  setShowLocation: (show: boolean) => void;
  traceInfo?: { colo: string; raw: string } | null;
  edgeLocation?: string | null;
}

export const VerifyConnectionCard: React.FC<VerifyConnectionCardProps> = ({
  isVerifying,
  verifyResult,
  handleVerify,
  isMobile,
  clientInfo,
  showIp,
  setShowIp,
  showLocation,
  setShowLocation,
  traceInfo,
  edgeLocation,
}) => {
  const { t } = useTranslation();
  const { isServerfull } = useDeploymentMode();
  const [isTraceOpen, setIsTraceOpen] = useState(false);
  const [copiedTrace, setCopiedTrace] = useState(false);

  const handleCopyTrace = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (traceInfo?.raw) {
      navigator.clipboard.writeText(traceInfo.raw);
      setCopiedTrace(true);
      setTimeout(() => setCopiedTrace(false), 2000);
    }
  };

  const traceEntries = useMemo(() => {
    if (!traceInfo?.raw) return [];
    return traceInfo.raw
      .trim()
      .split("\n")
      .map((line) => {
        const idx = line.indexOf("=");
        if (idx === -1) return null;
        return {
          key: line.slice(0, idx).trim(),
          value: line.slice(idx + 1).trim(),
        };
      })
      .filter((entry): entry is { key: string; value: string } => Boolean(entry));
  }, [traceInfo?.raw]);

  const edgeServerCardNode = (
    <div
      className={clsx(
        "bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-3 select-none h-full transition-all",
        !isServerfull && "cursor-pointer hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-md group"
      )}
    >
      <Server size={18} className="text-purple-500 mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase font-bold opacity-40">
            {isServerfull ? t("setup.serverLocation", "服务器位置") : t("setup.edgeServer")}
          </div>
          {!isServerfull && (
            <ChevronDown
              size={14}
              className={clsx(
                "text-gray-400 group-hover:text-purple-500 transition-transform duration-200",
                isTraceOpen && "rotate-180 text-purple-500"
              )}
            />
          )}
        </div>
        <div
          className="font-bold truncate"
          title={isServerfull ? (edgeLocation || "") : (edgeLocation || traceInfo?.colo || "")}
        >
          {isServerfull
            ? (edgeLocation || t("setup.detecting"))
            : (edgeLocation || traceInfo?.colo || t("setup.detecting"))}
        </div>
      </div>
    </div>
  );

  return (
    <Section title={t("setup.verifyConnection")} icon={<Activity size={16} />}>
      <SectionCard>
        <div className="flex flex-col space-y-6">
          <div className="flex flex-col md:flex-row items-center justify-between bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-gray-100 dark:border-gray-800 gap-6">
            <div className="flex flex-col md:flex-row items-center gap-4 text-center md:text-left">
              <div
                className={`p-3 rounded-full ${
                  verifyResult?.success ? "bg-green-100 text-green-600" : verifyResult ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                }`}
              >
                {isVerifying ? <Spinner size={24} /> : verifyResult?.success ? <ShieldCheck size={24} /> : <Server size={24} />}
              </div>
              <div>
                <div className="font-bold text-lg">
                  {isVerifying ? t("setup.verifying") : verifyResult?.success ? t("setup.connected") : t("setup.notConnected")}
                </div>
                <div className="text-sm opacity-60">
                  {verifyResult?.success
                    ? verifyResult.profileMatch
                      ? t("setup.profileMatch")
                      : t("setup.profileMismatch")
                    : t("setup.verifyHint")}
                </div>
              </div>
            </div>
            <Button
              size="large"
              intent={verifyResult?.success ? Intent.SUCCESS : Intent.PRIMARY}
              icon="refresh"
              text={t("setup.refreshStatus")}
              onClick={handleVerify}
              loading={isVerifying}
              fill={isMobile}
            />
          </div>

          {clientInfo && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-3">
                <Globe size={18} className="text-blue-500 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase font-bold opacity-40">{t("setup.egressIp")}</div>
                    <button onClick={() => setShowIp(!showIp)} className="text-gray-400 hover:text-blue-500 transition-colors">
                      {showIp ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  </div>
                  <div className="font-mono font-bold text-blue-600 dark:text-blue-400 truncate">
                    <span className={clsx("transition-[filter] duration-200 inline-block", !showIp && "filter blur-[6px] select-none")}>
                      {clientInfo.ip}
                    </span>
                  </div>
                </div>
              </div>
              <div className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-3">
                <MapPin size={18} className="text-red-500 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase font-bold opacity-40">{t("setup.currentLocation")}</div>
                    <button onClick={() => setShowLocation(!showLocation)} className="text-gray-400 hover:text-red-500 transition-colors">
                      {showLocation ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  </div>
                  <div className="font-bold truncate">
                    <span className={clsx("transition-[filter] duration-200 inline-block", !showLocation && "filter blur-[6px] select-none")}>
                      {(() => {
                        const parts = [clientInfo.city, clientInfo.region, clientInfo.country].filter(
                          (p): p is string => Boolean(p && p !== "UNKNOWN")
                        );
                        return parts.length > 0 ? parts.join(", ") : t("setup.detecting");
                      })()}
                    </span>
                  </div>
                </div>
              </div>
              {!isServerfull ? (
                <PopoverNext
                  isOpen={isTraceOpen}
                  onInteraction={setIsTraceOpen}
                  placement="bottom-end"
                  portalClassName="z-20000"
                  fill={true}
                  targetProps={{ className: "h-full" }}
                  content={
                    <div className="p-4 w-80 sm:w-96 max-w-[90vw] text-left text-sm space-y-3">
                      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-2">
                        <div className="flex items-center gap-2">
                          <Server size={16} className="text-purple-500" />
                          <span className="font-bold text-gray-900 dark:text-gray-100 text-xs sm:text-sm">
                            {t("setup.traceDetails", "/cdn-cgi/trace")}
                          </span>
                        </div>
                        <Button
                          size="small"
                          variant="minimal"
                          icon={copiedTrace ? "tick" : "duplicate"}
                          intent={copiedTrace ? Intent.SUCCESS : Intent.NONE}
                          text={copiedTrace ? t("common.copied", "已复制") : t("common.copy", "复制")}
                          onClick={handleCopyTrace}
                          disabled={!traceInfo?.raw}
                        />
                      </div>

                      {traceInfo?.raw ? (
                        <>
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            {traceEntries
                              .filter((e) => ["colo", "loc", "http", "tls", "kex", "sni", "warp"].includes(e.key))
                              .map((e) => (
                                <div
                                  key={e.key}
                                  className="bg-gray-50 dark:bg-gray-800/80 p-2 rounded border border-gray-100 dark:border-gray-700/60 flex flex-col min-w-0"
                                >
                                  <span className="text-[10px] uppercase font-mono opacity-50">{e.key}</span>
                                  <span className="font-mono font-bold text-purple-600 dark:text-purple-400 truncate" title={e.value}>
                                    {e.value}
                                  </span>
                                </div>
                              ))}
                          </div>

                          <pre className="bg-gray-50 dark:bg-gray-900 p-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[11px] font-mono leading-relaxed overflow-x-auto max-h-48 overflow-y-auto text-gray-700 dark:text-gray-300 select-text">
                            {traceInfo.raw}
                          </pre>
                        </>
                      ) : (
                        <div className="text-center py-4 text-xs opacity-60">
                          {t("setup.noTraceData", "暂无 Trace 数据")}
                        </div>
                      )}
                    </div>
                  }
                >
                  {edgeServerCardNode}
                </PopoverNext>
              ) : (
                edgeServerCardNode
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </Section>
  );
};
