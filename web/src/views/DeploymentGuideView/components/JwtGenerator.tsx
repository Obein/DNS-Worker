import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Intent } from "@blueprintjs/core";

const generateSecureSecret = (): string => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint32Array(64);
  window.crypto.getRandomValues(array);
  let secret = "";
  for (let i = 0; i < array.length; i++) {
    secret += chars[array[i] % chars.length];
  }
  return secret;
};

export const JwtGenerator: React.FC = () => {
  const { t } = useTranslation();
  // Lazy initializer: generated once on first render rather than via a
  // mount effect, which rendered an empty field for one frame.
  const [generatedSecret, setGeneratedSecret] = useState<string>(generateSecureSecret);
  const [copied, setCopied] = useState(false);

  const handleRegenerate = () => {
    setGeneratedSecret(generateSecureSecret());
    setCopied(false);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy text:", e);
    }
  };

  return (
    <div className="mb-6 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 bg-zinc-50 dark:bg-zinc-950/60 shadow-inner">
      <h3 className="text-sm font-bold text-gray-900 dark:text-zinc-100 mb-1 flex items-center gap-2 mt-0">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        {t("deploymentGuide.jwtGeneratorTitle")}
      </h3>
      <p className="text-gray-500 dark:text-zinc-400 text-xs mb-3">
        {t("deploymentGuide.jwtGeneratorDesc")}
      </p>
      
      <div className="flex gap-2 items-center">
        <div className="flex-1 font-mono text-xs p-3 bg-zinc-900 dark:bg-black text-zinc-100 rounded-lg select-all overflow-x-auto border border-zinc-800/80 shadow-inner leading-relaxed break-all whitespace-nowrap scrollbar-thin">
          {generatedSecret}
        </div>
        <div className="flex flex-col sm:flex-row gap-1.5 shrink-0">
          <Button
            intent={copied ? Intent.SUCCESS : Intent.NONE}
            icon={copied ? "tick" : "duplicate"}
            text={copied ? t("deploymentGuide.copied") : t("deploymentGuide.copy")}
            onClick={handleCopy}
            size="small"
          />
          <Button
            icon="refresh"
            text={t("deploymentGuide.regenerate")}
            onClick={handleRegenerate}
            size="small"
          />
        </div>
      </div>
    </div>
  );
};
