import React from "react";
import {
  Icon, 
  type IconName,
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export const getDeviceIcon = (userAgent: string | null): IconName => {
  if (!userAgent) return "desktop";
  const ua = userAgent.toLowerCase();
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone")) return "mobile-phone";
  if (ua.includes("tablet") || ua.includes("ipad")) return "mobile-phone";
  return "desktop";
};

export const getBrowserName = (userAgent: string | null, fallback: string): string => {
  if (!userAgent) return fallback;
  const ua = userAgent;
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  return fallback;
};

export interface UserAgentDisplayProps {
  userAgent: string | null;
}

export const UserAgentDisplay: React.FC<UserAgentDisplayProps> = ({ userAgent }) => {
  const { t } = useTranslation();
  
  if (!userAgent) {
    return <span className="text-gray-500">—</span>;
  }

  const unknownText = t("account.sessions.unknownDevice", "Unknown Device");
  const browserName = getBrowserName(userAgent, unknownText);

  return (
    <div>
      <div className="flex items-center gap-2">
        <Icon icon={getDeviceIcon(userAgent)} className="text-gray-400" />
        <span>{browserName}</span>
      </div>
      <div className="text-xs text-gray-400 mt-1 max-w-xs truncate" title={userAgent}>
        {userAgent}
      </div>
    </div>
  );
};
