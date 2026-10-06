import React from "react";
import {
  Dialog,
  Classes,
  Callout,
  FormGroup,
  InputGroup,
  Button,
  Intent
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface UnlockRecoveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recoveryKeyInput: string;
  setRecoveryKeyInput: (val: string) => void;
  recoveryUnlockError: string;
  processing: boolean;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}

export const UnlockRecoveryDialog: React.FC<UnlockRecoveryDialogProps> = ({
  isOpen,
  onClose,
  recoveryKeyInput,
  setRecoveryKeyInput,
  recoveryUnlockError,
  processing,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("account.e2ee.unlockWithRecoveryTitle")}
      icon="key"
      className="dark:bg-gray-900"
    >
      <form onSubmit={onSubmit}>
        <div className={Classes.DIALOG_BODY}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t("account.e2ee.unlockWithRecoveryDesc")}
          </p>
          {recoveryUnlockError && (
            <Callout intent={Intent.DANGER} className="mb-3 text-xs">
              {recoveryUnlockError}
            </Callout>
          )}
          <FormGroup
            label={t("account.e2ee.recoveryKeyInputLabel")}
            labelFor="recovery-key-input"
          >
            <InputGroup
              id="recovery-key-input"
              placeholder="123456-789012-345678-901234-567890"
              value={recoveryKeyInput}
              onChange={(e) => setRecoveryKeyInput(e.target.value)}
              leftIcon="key"
              className="font-mono text-xs"
              autoFocus
            />
          </FormGroup>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={onClose} text={t("common.cancel")} />
            <Button
              type="submit"
              intent={Intent.PRIMARY}
              loading={processing}
              disabled={!recoveryKeyInput.trim()}
              text={t("account.e2ee.unlockConfirm")}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
};
