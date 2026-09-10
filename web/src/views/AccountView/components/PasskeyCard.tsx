import React, { useState, useEffect, useCallback } from "react";
import {
  Card,
  Elevation,
  H4,
  Tag,
  Button,
  Intent,
  Callout,
  Dialog,
  FormGroup,
  InputGroup,
  Classes,
  Spinner
} from "@blueprintjs/core";
import { KeyRound, Fingerprint, Plus, Trash2, Edit2, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import {
  getPasskeys,
  getPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  renamePasskey,
  deletePasskey
} from "../../../services";
import type { Passkey } from "../../../services";
import { isPasskeySupported, startPasskeyRegistration } from "../../../utils/webauthn";

export interface PasskeyCardProps {
  onRefresh?: () => void;
}

export const PasskeyCard: React.FC<PasskeyCardProps> = ({ onRefresh }) => {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);

  // Add Passkey state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [passkeyName, setPasskeyName] = useState("");
  const [registering, setRegistering] = useState(false);
  const [addError, setAddError] = useState("");

  // Rename state
  const [editingPasskey, setEditingPasskey] = useState<Passkey | null>(null);
  const [editName, setEditName] = useState("");
  const [renaming, setRenaming] = useState(false);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [targetToDelete, setTargetToDelete] = useState<Passkey | null>(null);

  const fetchPasskeys = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPasskeys();
      setPasskeys(data || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSupported(isPasskeySupported());
    fetchPasskeys();
  }, [fetchPasskeys]);

  const handleOpenAdd = () => {
    setPasskeyName("");
    setAddError("");
    setIsAddOpen(true);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistering(true);
    setAddError("");

    try {
      const options = await getPasskeyRegistrationOptions();
      const credential = await startPasskeyRegistration(options);
      await verifyPasskeyRegistration({
        name: passkeyName.trim() || t("account.passkey.defaultName", "Passkey"),
        credential
      });

      setIsAddOpen(false);
      setPasskeyName("");
      await fetchPasskeys();
      onRefresh?.();
    } catch (err: any) {
      console.error("Passkey registration failed:", err);
      setAddError(err.message || t("account.passkey.regFailed", "Registration failed"));
    } finally {
      setRegistering(false);
    }
  };

  const handleOpenRename = (pk: Passkey) => {
    setEditingPasskey(pk);
    setEditName(pk.name);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPasskey || !editName.trim()) return;

    setRenaming(true);
    try {
      await renamePasskey(editingPasskey.id, editName.trim());
      setEditingPasskey(null);
      await fetchPasskeys();
    } catch (err: any) {
      alert(err.message || t("common.errorNetwork"));
    } finally {
      setRenaming(false);
    }
  };

  const handleOpenDelete = (pk: Passkey) => {
    setTargetToDelete(pk);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteSubmit = async () => {
    if (!targetToDelete) return;
    setDeletingId(targetToDelete.id);
    try {
      await deletePasskey(targetToDelete.id);
      setDeleteConfirmOpen(false);
      setTargetToDelete(null);
      await fetchPasskeys();
      onRefresh?.();
    } catch (err: any) {
      alert(err.message || t("common.errorNetwork"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Fingerprint size={20} className="text-purple-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.passkey.title", "Passkeys")}
          </H4>
          <Tag
            intent={passkeys.length > 0 ? Intent.SUCCESS : Intent.NONE}
            minimal
            round
          >
            {passkeys.length > 0
              ? t("account.passkey.count", { count: passkeys.length, defaultValue: `${passkeys.length} configured` })
              : t("account.passkey.none", "None configured")}
          </Tag>
        </div>

        {supported && (
          <Button
            intent={Intent.PRIMARY}
            icon={<Plus size={16} />}
            text={t("account.passkey.addBtn", "Add Passkey")}
            onClick={handleOpenAdd}
          />
        )}
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        {t(
          "account.passkey.desc",
          "Authenticate securely with biometrics (Touch ID, Face ID, Windows Hello) or a hardware security key (YubiKey) as an MFA factor."
        )}
      </p>

      {!supported && (
        <Callout intent={Intent.WARNING} icon={<ShieldAlert size={16} />} className="mb-4">
          {t("account.passkey.notSupported", "Your browser or device does not support Passkeys (WebAuthn).")}
        </Callout>
      )}

      {loading ? (
        <div className="py-6 text-center">
          <Spinner size={24} />
        </div>
      ) : passkeys.length === 0 ? (
        <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-800 rounded-lg">
          <KeyRound size={28} className="mx-auto mb-2 opacity-40" />
          <p>{t("account.passkey.empty", "No passkeys added yet.")}</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800 border border-gray-200 dark:border-gray-800 rounded-lg overflow-hidden">
          {passkeys.map((pk) => (
            <div
              key={pk.id}
              className="p-3 sm:p-4 flex items-center justify-between gap-3 hover:bg-gray-50 dark:hover:bg-gray-900/40 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="p-2 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-lg shrink-0">
                  <KeyRound size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm truncate text-gray-900 dark:text-gray-100">
                    {pk.name}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-x-3 gap-y-1 mt-0.5">
                    <span>
                      {t("account.passkey.created", "Added")}: {formatDateTime(new Date(pk.created_at * 1000))}
                    </span>
                    {pk.last_used_at ? (
                      <span>
                        {t("account.passkey.lastUsed", "Last used")}: {formatDateTime(new Date(pk.last_used_at * 1000))}
                      </span>
                    ) : (
                      <span>{t("account.passkey.neverUsed", "Never used")}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <Button
                  minimal
                  small
                  icon={<Edit2 size={14} />}
                  title={t("common.rename", "Rename")}
                  onClick={() => handleOpenRename(pk)}
                />
                <Button
                  minimal
                  small
                  intent={Intent.DANGER}
                  icon={<Trash2 size={14} />}
                  title={t("common.delete", "Delete")}
                  loading={deletingId === pk.id}
                  onClick={() => handleOpenDelete(pk)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Passkey Dialog */}
      <Dialog
        isOpen={isAddOpen}
        onClose={() => !registering && setIsAddOpen(false)}
        title={t("account.passkey.addTitle", "Add New Passkey")}
        className="max-w-md"
      >
        <form onSubmit={handleRegister}>
          <div className={Classes.DIALOG_BODY}>
            {addError && (
              <Callout intent={Intent.DANGER} className="mb-4">
                {addError}
              </Callout>
            )}
            <FormGroup
              label={t("account.passkey.nameLabel", "Passkey Name")}
              labelFor="passkey-name-input"
              helperText={t("account.passkey.nameHelper", "e.g. MacBook Touch ID, iPhone, YubiKey 5")}
            >
              <InputGroup
                id="passkey-name-input"
                autoFocus
                placeholder={t("account.passkey.namePlaceholder", "My Device")}
                value={passkeyName}
                onChange={(e) => setPasskeyName(e.target.value)}
                disabled={registering}
              />
            </FormGroup>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t(
                "account.passkey.promptNotice",
                "After clicking continue, your browser will prompt you to authenticate via fingerprint, face scan, PIN, or hardware key."
              )}
            </p>
          </div>
          <div className={Classes.DIALOG_FOOTER}>
            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
              <Button
                text={t("common.cancel", "Cancel")}
                onClick={() => setIsAddOpen(false)}
                disabled={registering}
              />
              <Button
                intent={Intent.PRIMARY}
                type="submit"
                text={t("account.passkey.continue", "Continue")}
                loading={registering}
              />
            </div>
          </div>
        </form>
      </Dialog>

      {/* Rename Dialog */}
      <Dialog
        isOpen={!!editingPasskey}
        onClose={() => !renaming && setEditingPasskey(null)}
        title={t("account.passkey.renameTitle", "Rename Passkey")}
        className="max-w-md"
      >
        <form onSubmit={handleRenameSubmit}>
          <div className={Classes.DIALOG_BODY}>
            <FormGroup label={t("account.passkey.nameLabel", "Passkey Name")}>
              <InputGroup
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={renaming}
              />
            </FormGroup>
          </div>
          <div className={Classes.DIALOG_FOOTER}>
            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
              <Button
                text={t("common.cancel", "Cancel")}
                onClick={() => setEditingPasskey(null)}
                disabled={renaming}
              />
              <Button
                intent={Intent.PRIMARY}
                type="submit"
                text={t("common.save", "Save")}
                loading={renaming}
              />
            </div>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        isOpen={deleteConfirmOpen}
        onClose={() => !deletingId && setDeleteConfirmOpen(false)}
        title={t("account.passkey.deleteTitle", "Delete Passkey")}
        className="max-w-md"
      >
        <div className={Classes.DIALOG_BODY}>
          <p>
            {t(
              "account.passkey.deleteConfirm",
              "Are you sure you want to delete passkey \"{{name}}\"? You will no longer be able to use this passkey for MFA.",
              { name: targetToDelete?.name }
            )}
          </p>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button
              text={t("common.cancel", "Cancel")}
              onClick={() => setDeleteConfirmOpen(false)}
              disabled={!!deletingId}
            />
            <Button
              intent={Intent.DANGER}
              text={t("common.delete", "Delete")}
              onClick={handleDeleteSubmit}
              loading={!!deletingId}
            />
          </div>
        </div>
      </Dialog>
    </Card>
  );
};
