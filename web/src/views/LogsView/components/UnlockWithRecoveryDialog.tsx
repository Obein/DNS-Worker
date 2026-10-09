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

export interface UnlockWithRecoveryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  recoveryKeyInput: string;
  setRecoveryKeyInput: React.Dispatch<React.SetStateAction<string>>;
  recoveryError: string;
  unlocking: boolean;
  onSubmit: (e: React.FormEvent) => Promise<void>;
}

/**
 * Dialog enabling users to unlock encrypted logs using their 30-digit emergency recovery key.
 */
export const UnlockWithRecoveryDialog: React.FC<UnlockWithRecoveryDialogProps> = ({
  isOpen,
  onClose,
  recoveryKeyInput,
  setRecoveryKeyInput,
  recoveryError,
  unlocking,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("account.e2ee.unlockWithRecoveryTitle", "使用恢复密钥解锁")}
      icon="key"
      className="dark:bg-gray-900"
    >
      <form onSubmit={onSubmit} autoComplete="off">
        <div className={Classes.DIALOG_BODY}>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t(
              "account.e2ee.unlockWithRecoveryDesc",
              "请输入 30 位紧急恢复密钥。注意：根据单次使用规则，恢复密钥验证成功后将立即自动轮换。"
            )}
          </p>
          {recoveryError && (
            <Callout intent={Intent.DANGER} className="mb-3 text-xs">
              {recoveryError}
            </Callout>
          )}
          <FormGroup
            label={t("account.e2ee.recoveryKeyInputLabel", "恢复密钥")}
            labelFor="recovery-key-input-logs"
          >
            <InputGroup
              id="recovery-key-input-logs"
              name="recovery_key_input_logs"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              data-bwignore="true"
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
            <Button onClick={onClose} text={t("common.cancel", "取消")} />
            <Button
              type="submit"
              intent={Intent.PRIMARY}
              loading={unlocking}
              disabled={!recoveryKeyInput.trim()}
              text={t("account.e2ee.unlockConfirm", "解锁日志")}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
};
