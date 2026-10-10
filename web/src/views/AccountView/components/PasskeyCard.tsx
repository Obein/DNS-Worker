import React, { useRef } from "react";
import {
  H4,
  Tag,
  Button,
  Intent,
  Callout,
  OverlayToaster
} from "@blueprintjs/core";
import { Key, Plus, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TOTPRecoveryKeys } from "./totp/TOTPRecoveryKeys";
import {
  usePasskeys,
  PasskeyList,
  AddPasskeyDialog,
  RenamePasskeyDialog,
  DeletePasskeyDialog
} from "./passkey";

export interface PasskeyCardProps {
  onRefresh?: () => void;
}

/**
 * PasskeyCard coordinates WebAuthn passkey management for the user account.
 * Adheres to the Separation of Concerns principle by delegating state management
 * to usePasskeys and view rendering to PasskeyList and specialized Dialog components.
 *
 * @param props - Component props containing optional refresh callback.
 * @returns React component representing the Passkeys management card.
 */
export const PasskeyCard: React.FC<PasskeyCardProps> = ({ onRefresh }) => {
  const { t } = useTranslation();
  const toasterRef = useRef<OverlayToaster | null>(null);

  const {
    passkeys,
    loading,
    supported,
    recoveryKeys,
    setRecoveryKeys,
    copiedKeys,
    handleCopyRecoveryKeys,
    isAddOpen,
    setIsAddOpen,
    passkeyName,
    setPasskeyName,
    nameFocused,
    setNameFocused,
    registering,
    addError,
    setAddError,
    handleOpenAdd,
    handleRegister,
    editingPasskey,
    setEditingPasskey,
    editName,
    setEditName,
    renameFocused,
    setRenameFocused,
    renaming,
    renameError,
    setRenameError,
    handleOpenRename,
    handleRenameSubmit,
    deletingId,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    targetToDelete,
    handleOpenDelete,
    handleDeleteSubmit,
    testingId,
    handleTestPasskey
  } = usePasskeys({ onRefresh, toasterRef });

  // Phase 1: show recovery keys after setup if generated
  if (recoveryKeys) {
    return (
      <TOTPRecoveryKeys
        recoveryKeys={recoveryKeys}
        copied={copiedKeys}
        onCopy={handleCopyRecoveryKeys}
        onDone={() => setRecoveryKeys(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <OverlayToaster ref={toasterRef} />

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Key size={20} className="text-purple-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.passkey.title", "Passkeys")}
          </H4>
          <Tag
            intent={passkeys.length > 0 ? Intent.SUCCESS : Intent.NONE}
            minimal
            round
          >
            {passkeys.length > 0
              ? t("account.passkey.count", {
                  count: passkeys.length,
                  defaultValue: `${passkeys.length} configured`
                })
              : t("account.passkey.none", "None configured")}
          </Tag>
        </div>

        <div className="flex items-center gap-2">
          {supported && passkeys.length > 0 && (
            <Button
              intent={Intent.NONE}
              outlined
              icon={<ShieldCheck size={16} />}
              text={t("account.passkey.testBtn", "Test Passkey")}
              onClick={() => handleTestPasskey()}
              loading={testingId === "all"}
            />
          )}
          {supported && (
            <Button
              intent={Intent.PRIMARY}
              icon={<Plus size={16} />}
              text={t("account.passkey.addBtn", "Add Passkey")}
              onClick={handleOpenAdd}
            />
          )}
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t(
          "account.passkey.desc",
          "Authenticate securely with biometrics (Touch ID, Face ID, Windows Hello) or a hardware security key (YubiKey) as an MFA factor."
        )}
      </p>

      {!supported && (
        <Callout
          intent={Intent.WARNING}
          icon={<ShieldAlert size={16} />}
          className="mb-4"
        >
          {t(
            "account.passkey.notSupported",
            "Your browser or device does not support Passkeys (WebAuthn)."
          )}
        </Callout>
      )}

      <PasskeyList
        passkeys={passkeys}
        loading={loading}
        deletingId={deletingId}
        testingId={testingId}
        onTestPasskey={handleTestPasskey}
        onOpenRename={handleOpenRename}
        onOpenDelete={handleOpenDelete}
      />

      <AddPasskeyDialog
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        passkeyName={passkeyName}
        setPasskeyName={setPasskeyName}
        nameFocused={nameFocused}
        setNameFocused={setNameFocused}
        registering={registering}
        addError={addError}
        setAddError={setAddError}
        onSubmit={handleRegister}
      />

      <RenamePasskeyDialog
        isOpen={Boolean(editingPasskey)}
        onClose={() => setEditingPasskey(null)}
        editName={editName}
        setEditName={setEditName}
        renameFocused={renameFocused}
        setRenameFocused={setRenameFocused}
        renaming={renaming}
        renameError={renameError}
        setRenameError={setRenameError}
        onSubmit={handleRenameSubmit}
      />

      <DeletePasskeyDialog
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        targetToDelete={targetToDelete}
        deleting={Boolean(deletingId)}
        onConfirm={handleDeleteSubmit}
      />
    </div>
  );
};
