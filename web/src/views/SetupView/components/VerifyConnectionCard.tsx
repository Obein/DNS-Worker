import React, { useState } from "react";
import { Section, SectionCard, Button, Spinner, Intent, PopoverNext } from "@blueprintjs/core";
import { Activity, ShieldCheck, Server, Globe, MapPin, Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  ClientInfo  } from "../types";

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
  traceInfo: { colo: string; raw: string } | null;
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
}) => {
  const { t } = useTranslation();
  const [isTracePopoverOpen, setIsTracePopoverOpen] = useState(false);

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
            <div className={`grid grid-cols-1 gap-4 ${traceInfo ? "sm:grid-cols-2 md:grid-cols-3" : "md:grid-cols-2"}`}>
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
                    {showIp ? clientInfo.ip : "• • • • • • • • • •"}
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
                    {showLocation ? `${clientInfo.city}, ${clientInfo.region ? `${clientInfo.region}, ` : ""}${clientInfo.country}` : "• • • • • • • • • •"}
                  </div>
                </div>
              </div>
              {traceInfo && (
                <PopoverNext
                  isOpen={isTracePopoverOpen}
                  onInteraction={(nextOpenState) => setIsTracePopoverOpen(nextOpenState)}
                  placement="bottom"
                  content={
                    <div className="p-4 max-w-sm max-h-60 overflow-auto font-mono text-xs bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 shadow-lg rounded-lg">
                      <div className="font-bold border-b border-gray-100 dark:border-gray-800 pb-2 mb-2">/cdn-cgi/trace</div>
                      <pre className="whitespace-pre-wrap">{traceInfo.raw}</pre>
                    </div>
                  }
                >
                  <div 
                    className="bg-white dark:bg-gray-900 p-4 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm flex items-start gap-3 cursor-pointer select-none"
                    onDoubleClick={() => setIsTracePopoverOpen(true)}
                  >
                    <Server size={18} className="text-purple-500 mt-1" />
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase font-bold opacity-40">{t("setup.edgeServer")}</div>
                      <div className="font-bold truncate">
                        {traceInfo.colo}
                      </div>
                    </div>
                  </div>
                </PopoverNext>
              )}
            </div>
          )}
        </div>
      </SectionCard>
    </Section>
  );
};
