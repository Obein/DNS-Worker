import React from "react";
import { Button, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface RecoveryKeyVerifyFormProps {
  recoveryKey: string;
  setRecoveryKey: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  onSubmit: (e?: React.FormEvent) => Promise<void>;
}

/**
 * Form for verifying identity using the 30-digit recovery key.
 */
export const RecoveryKeyVerifyForm: React.FC<RecoveryKeyVerifyFormProps> = ({
  recoveryKey,
  setRecoveryKey,
  loading,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="py-2 space-y-4">
      <FormGroup label={t("account.recoveryKey.verifyPromptLabel", "原恢复密钥 (Original Recovery Key)")}>
        <InputGroup
          leftIcon="key"
          type="text"
          placeholder="123456-789012-345678-901234-567890"
          value={recoveryKey}
          onChange={(e) => setRecoveryKey(e.target.value)}
          autoFocus
          className="font-mono text-xs"
        />
      </FormGroup>
      <Button
        fill
        intent={Intent.PRIMARY}
        type="submit"
        loading={loading}
        disabled={!recoveryKey.trim()}
        text={t("common.confirm", "Confirm")}
      />
    </form>
  );
};
