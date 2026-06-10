import React from "react";
import { Card, Elevation, H4, Callout, Intent, Button } from "@blueprintjs/core";
import { ShieldCheck, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Properties for the TOTPRecoveryKeys component.
 */
export interface TOTPRecoveryKeysProps {
  /** Array of recovery keys generated for the user. */
  recoveryKeys: string[];
  /** Flag showing if recovery keys have been copied to the clipboard. */
  copied: boolean;
  /** Callback to handle copying the recovery keys to clipboard. */
  onCopy: () => void;
  /** Callback triggered when user finishes acknowledging recovery keys. */
  onDone: () => void;
}

/**
 * TOTPRecoveryKeys component renders the 2FA recovery keys after a successful setup.
 *
 * @param props - Component props.
 * @returns React element representing recovery keys card.
 */
export const TOTPRecoveryKeys: React.FC<TOTPRecoveryKeysProps> = ({
  recoveryKeys,
  copied,
  onCopy,
  onDone
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center gap-2 mb-4">
        <ShieldCheck size={20} className="text-green-500" />
        <H4 style={{ margin: 0 }}>
          {t("account.totp.recoveryKeysTitle", "Save Your Recovery Keys")}
        </H4>
      </div>
      <Callout intent={Intent.WARNING} className="mb-4">
        {t(
          "account.totp.recoveryKeysWarning",
          "Store these keys safely. Each key can only be used once. You will NOT see them again."
        )}
      </Callout>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {recoveryKeys.map((key, i) => (
          <code
            key={i}
            className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded text-center tracking-wider"
          >
            {key}
          </code>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          fill
          icon={<Copy size={14} />}
          text={
            copied
              ? t("account.totp.copied", "Copied!")
              : t("account.totp.copyKeys", "Copy All Keys")
          }
          intent={copied ? Intent.SUCCESS : Intent.NONE}
          onClick={onCopy}
        />
        <Button
          fill
          intent={Intent.PRIMARY}
          text={t("account.totp.done", "Done, I've saved them")}
          onClick={onDone}
        />
      </div>
    </Card>
  );
};
