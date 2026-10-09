import React from "react";
import { Server, Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import { useDeploymentMode } from "../../hooks/useDeploymentMode";

export interface DeploymentModeBadgeProps {
  size?: "small" | "normal";
  showIcon?: boolean;
  className?: string;
}

/**
 * Visual badge indicating whether the application is running in
 * Serverfull (Node.js/VPS) mode or Cloudflare Workers (Serverless) mode.
 */
export const DeploymentModeBadge: React.FC<DeploymentModeBadgeProps> = ({
  size = "normal",
  showIcon = true,
  className,
}) => {
  const { isServerfull } = useDeploymentMode();
  const { t } = useTranslation();

  const isSmall = size === "small";

  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1.5 font-medium rounded-full transition-colors select-none",
        isSmall ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs",
        isServerfull
          ? "bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800"
          : "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800",
        className
      )}
      title={isServerfull ? "Self-Hosted / Node.js Serverfull" : "Cloudflare Workers Serverless"}
    >
      {showIcon && (
        isServerfull ? (
          <Server size={isSmall ? 12 : 14} className="shrink-0 text-purple-600 dark:text-purple-400" />
        ) : (
          <Cloud size={isSmall ? 12 : 14} className="shrink-0 text-blue-600 dark:text-blue-400" />
        )
      )}
      <span>{isServerfull ? t("common.modeServerfull") : t("common.modeCloudflare")}</span>
    </div>
  );
};
