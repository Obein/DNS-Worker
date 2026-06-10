import React from "react";
import { Button, Intent } from "@blueprintjs/core";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Properties for the SignupRecoveryStep component.
 */
export interface SignupRecoveryStepProps {
  /** The generated recovery keys array. */
  totpRecoveryKeys: string[];
  /** Flag showing if recovery keys have just been copied to the clipboard. */
  copiedRecovery: boolean;
  /** Callback to copy keys to the clipboard. */
  onCopy: () => void;
  /** Callback to finish the wizard and redirect/proceed. */
  onSuccess: () => void;
}

/**
 * SignupRecoveryStep is the final step of the signup wizard.
 * It forces the user to view and save recovery keys to avoid lockout.
 *
 * @param props - Component props.
 * @returns React element representing recovery keys step.
 */
export const SignupRecoveryStep: React.FC<SignupRecoveryStepProps> = ({
  totpRecoveryKeys,
  copiedRecovery,
  onCopy,
  onSuccess
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 mb-4">
        {totpRecoveryKeys.map((key: string, i: number) => (
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
            copiedRecovery
              ? t("account.totp.copied", "Copied!")
              : t("account.totp.copyKeys", "Copy All Keys")
          }
          intent={copiedRecovery ? Intent.SUCCESS : Intent.NONE}
          onClick={onCopy}
        />
        <Button
          fill
          intent={Intent.PRIMARY}
          text={t("account.totp.done", "Done")}
          onClick={onSuccess}
        />
      </div>
    </div>
  );
};
