import React from "react";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "./CodeBlock";

export interface ServerfullGuideProps {
  isDbMissing: boolean;
  isJwtSecretMissing: boolean;
}

/**
 * Deployment and troubleshooting guide tailored for Serverfull (Node.js/VPS) mode.
 */
export const ServerfullGuide: React.FC<ServerfullGuideProps> = ({
  isDbMissing,
  isJwtSecretMissing,
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Step 1: Database (SQLite) */}
      <div>
        <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 mb-1 flex items-center gap-2 mt-0">
          <span className="flex items-center justify-center w-5 h-5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold">
            1
          </span>
          {t("deploymentGuide.serverfullStepInstallTitle")}
        </h3>
        <p className="text-gray-600 dark:text-zinc-400 text-xs mb-2">
          {t("deploymentGuide.serverfullStepInstallDesc")}
        </p>
        <CodeBlock
          code={t("deploymentGuide.serverfullStepInstallCmd")}
          copyText={t("deploymentGuide.copy")}
          copiedText={t("deploymentGuide.copied")}
        />
        {isDbMissing && (
          <p className="text-amber-600 dark:text-amber-400 text-xs mt-2 font-medium">
            ⚠️ {t("deploymentGuide.serverfullDbMissingHint")}
          </p>
        )}
      </div>

      {/* Step 2: JWT_SECRET in .env */}
      <div className="border-t border-gray-100 dark:border-zinc-800 pt-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 mb-1 flex items-center gap-2 mt-0">
          <span className="flex items-center justify-center w-5 h-5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold">
            2
          </span>
          {t("deploymentGuide.serverfullStepEnvTitle")}
        </h3>
        <p className="text-gray-600 dark:text-zinc-400 text-xs mb-2">
          {t("deploymentGuide.serverfullStepEnvDesc")}
        </p>
        <CodeBlock
          code={t("deploymentGuide.serverfullStepEnvCmd")}
          copyText={t("deploymentGuide.copy")}
          copiedText={t("deploymentGuide.copied")}
        />
        {isJwtSecretMissing && (
          <p className="text-blue-600 dark:text-blue-400 text-xs mt-2 font-medium">
            💡 {t("deploymentGuide.serverfullJwtMissingHint")}
          </p>
        )}
      </div>

      {/* Step 3: Restart Service */}
      <div className="border-t border-gray-100 dark:border-zinc-800 pt-4">
        <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 mb-1 flex items-center gap-2 mt-0">
          <span className="flex items-center justify-center w-5 h-5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs font-bold">
            3
          </span>
          {t("deploymentGuide.serverfullStepServiceTitle")}
        </h3>
        <p className="text-gray-600 dark:text-zinc-400 text-xs mb-2">
          {t("deploymentGuide.serverfullStepServiceDesc")}
        </p>
        <CodeBlock
          code={t("deploymentGuide.serverfullStepServiceCmd")}
          copyText={t("deploymentGuide.copy")}
          copiedText={t("deploymentGuide.copied")}
        />
      </div>
    </div>
  );
};
