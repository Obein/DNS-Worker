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

export interface InitRecoveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initRecoveryKeyInput: string;
  setInitRecoveryKeyInput: (val: string) => void;
  initRecoveryError: string;
  processing: boolean;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}

export const InitRecoveryDialog: React.FC<InitRecoveryDialogProps> = ({
  isOpen,
  onClose,
  initRecoveryKeyInput,
  setInitRecoveryKeyInput,
  initRecoveryError,
  processing,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("account.e2ee.initWithRecoveryTitle")}
      icon="key"
      className="dark:bg-gray-900"
    >
      <form onSubmit={onSubmit} autoComplete="off">
        <div className={Classes.DIALOG_BODY}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t("account.e2ee.initWithRecoveryDesc")}
          </p>
          {initRecoveryError && (
            <Callout intent={Intent.DANGER} className="mb-3 text-xs">
              {initRecoveryError}
            </Callout>
          )}
          <FormGroup
            label={t("account.e2ee.recoveryKeyInputLabel")}
            labelFor="init-recovery-key-input"
          >
            <InputGroup
              id="init-recovery-key-input"
              name="init_recovery_key_input"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
              placeholder="123456-789012-345678-901234-567890"
              value={initRecoveryKeyInput}
              onChange={(e) => setInitRecoveryKeyInput(e.target.value)}
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
              disabled={!initRecoveryKeyInput.trim()}
              text={t("account.e2ee.generateKeypairBtn")}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
};
