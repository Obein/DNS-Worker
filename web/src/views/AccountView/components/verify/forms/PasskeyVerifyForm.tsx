import React from "react";
import { Button, Intent } from "@blueprintjs/core";
import { Key } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface PasskeyVerifyFormProps {
  loading: boolean;
  onVerify: () => Promise<void>;
}

/**
 * Form / presentation for verifying identity using a WebAuthn Passkey.
 */
export const PasskeyVerifyForm: React.FC<PasskeyVerifyFormProps> = ({
  loading,
  onVerify
}) => {
  const { t } = useTranslation();

  return (
    <div className="text-center py-4 space-y-4">
      <div className="flex justify-center">
        <div className="p-4 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-500">
          <Key size={48} />
        </div>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-300">
        {t(
          "account.passkey.verifyPrompt",
          "Authenticate using your device's biometric sensor (Face ID, Touch ID, Windows Hello) or security key."
        )}
      </p>
      <Button
        fill
        large
        intent={Intent.PRIMARY}
        loading={loading}
        onClick={onVerify}
        icon={<Key size={16} />}
        text={t("account.usePasskeyInstead", "Authenticate with Passkey")}
      />
    </div>
  );
};
