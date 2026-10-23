import React from "react";
import { Dialog, Classes, Button, Intent, FormGroup, InputGroup, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { Passkey } from "../../../../services";

/**
 * Props for the DeletePasskeyDialog component.
 */
export interface DeletePasskeyDialogProps {
  /** Whether the modal dialog is open. */
  isOpen: boolean;
  /** Callback to close the dialog. */
  onClose: () => void;
  /** The target passkey selected for deletion. */
  targetToDelete: Passkey | null;
  /** Whether deletion is currently loading. */
  deleting: boolean;
  /** Confirmation handler to execute deletion. */
  onConfirm: () => void;
  /** Password entered for reauthentication. */
  password?: string;
  /** Setter for reauthentication password. */
  setPassword?: (pwd: string) => void;
  /** Error message to display. */
  error?: string;
}

/**
 * DeletePasskeyDialog renders the modal dialog to confirm deletion of a passkey
 * with mandatory step-up reauthentication.
 *
 * @param props - Component props.
 * @returns React modal dialog element.
 */
export const DeletePasskeyDialog: React.FC<DeletePasskeyDialogProps> = ({
  isOpen,
  onClose,
  targetToDelete,
  deleting,
  onConfirm,
  password,
  setPassword,
  error
}) => {
  const { t } = useTranslation();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    onConfirm();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={() => !deleting && onClose()}
      title={t("account.passkey.deleteTitle", "Delete Passkey")}
      className="max-w-md"
    >
      <form onSubmit={handleSubmit}>
        <div className={Classes.DIALOG_BODY}>
          <p>
            {t(
              "account.passkey.deleteConfirm",
              'Are you sure you want to delete passkey "{{name}}"? You will no longer be able to use this passkey for MFA.',
              { name: targetToDelete?.name }
            )}
          </p>
          {setPassword && (
            <FormGroup
              label={t("account.totp.enterPassword", "Enter your password to confirm:")}
              labelFor="delete-passkey-password"
              className="mt-3"
            >
              <InputGroup
                id="delete-passkey-password"
                type="password"
                placeholder={t("account.totp.passwordPlaceholder", "Account password")}
                value={password || ""}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </FormGroup>
          )}
          {error && (
            <Callout intent={Intent.DANGER} className="mt-2 text-xs">
              {error}
            </Callout>
          )}
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button
              text={t("common.cancel", "Cancel")}
              onClick={onClose}
              disabled={deleting}
            />
            <Button
              intent={Intent.DANGER}
              text={t("common.delete", "Delete")}
              type="submit"
              loading={deleting}
              disabled={deleting || !(password || "").trim()}
            />
          </div>
        </div>
      </form>
    </Dialog>
  );
};
