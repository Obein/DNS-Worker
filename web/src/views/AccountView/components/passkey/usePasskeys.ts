import React, { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import { validatePasskeyName } from "../../../../utils/auth";
import {
  getPasskeys,
  getPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  renamePasskey,
  deletePasskey,
  testPasskey,
  e2ee
} from "../../../../services";
import type { Passkey } from "../../../../services";
import { isPasskeySupported, startPasskeyRegistration } from "../../../../utils/webauthn";

/**
 * Properties passed to the usePasskeys hook.
 */
export interface UsePasskeysProps {
  /** Optional callback invoked to notify parent components of changes. */
  onRefresh?: () => void;
  /** Optional ref to Blueprint OverlayToaster for notifications. */
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

/**
 * Return type definition for the usePasskeys hook.
 */
export interface UsePasskeysReturn {
  /** Configured passkeys. */
  passkeys: Passkey[];
  /** Loading state during passkeys retrieval. */
  loading: boolean;
  /** Whether the current browser supports WebAuthn passkeys. */
  supported: boolean;

  /** Emergency recovery keys if generated during first MFA credential creation. */
  recoveryKeys: string[] | null;
  /** Setter for recovery keys. */
  setRecoveryKeys: (keys: string[] | null) => void;
  /** Whether recovery keys have been copied to clipboard. */
  copiedKeys: boolean;
  /** Handler to copy recovery keys to clipboard. */
  handleCopyRecoveryKeys: () => void;

  // Add Dialog State & Handlers
  isAddOpen: boolean;
  setIsAddOpen: (open: boolean) => void;
  passkeyName: string;
  setPasskeyName: (name: string) => void;
  nameFocused: boolean;
  setNameFocused: (focused: boolean) => void;
  registering: boolean;
  addError: string;
  setAddError: (err: string) => void;
  handleOpenAdd: () => void;
  handleRegister: (e: React.FormEvent) => Promise<void>;

  // Rename Dialog State & Handlers
  editingPasskey: Passkey | null;
  setEditingPasskey: (pk: Passkey | null) => void;
  editName: string;
  setEditName: (name: string) => void;
  renameFocused: boolean;
  setRenameFocused: (focused: boolean) => void;
  renaming: boolean;
  renameError: string;
  setRenameError: (err: string) => void;
  handleOpenRename: (pk: Passkey) => void;
  handleRenameSubmit: (e: React.FormEvent) => Promise<void>;

  // Delete Dialog State & Handlers
  deletingId: string | null;
  deleteConfirmOpen: boolean;
  setDeleteConfirmOpen: (open: boolean) => void;
  targetToDelete: Passkey | null;
  handleOpenDelete: (pk: Passkey) => void;
  handleDeleteSubmit: () => Promise<void>;

  // Test Passkey State & Handlers
  testingId: string | null;
  handleTestPasskey: (pk?: Passkey) => Promise<void>;

  /** Function to reload the passkey list. */
  fetchPasskeys: () => Promise<void>;
}

/**
 * Custom hook encapsulating state management, WebAuthn browser APIs,
 * and CRUD operations for Passkeys.
 *
 * @param props - Hook configuration.
 * @returns State and event handlers for managing passkeys.
 */
export const usePasskeys = ({ onRefresh, toasterRef }: UsePasskeysProps): UsePasskeysReturn => {
  const { t } = useTranslation();
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [supported, setSupported] = useState<boolean>(true);

  // Recovery keys state (if generated upon first MFA factor creation)
  const [recoveryKeys, setRecoveryKeys] = useState<string[] | null>(null);
  const [copiedKeys, setCopiedKeys] = useState<boolean>(false);

  // Test state
  const [testingId, setTestingId] = useState<string | null>(null);

  // Add Passkey state
  const [isAddOpen, setIsAddOpen] = useState<boolean>(false);
  const [passkeyName, setPasskeyName] = useState<string>("");
  const [nameFocused, setNameFocused] = useState<boolean>(false);
  const [registering, setRegistering] = useState<boolean>(false);
  const [addError, setAddError] = useState<string>("");

  // Rename state
  const [editingPasskey, setEditingPasskey] = useState<Passkey | null>(null);
  const [editName, setEditName] = useState<string>("");
  const [renameFocused, setRenameFocused] = useState<boolean>(false);
  const [renaming, setRenaming] = useState<boolean>(false);
  const [renameError, setRenameError] = useState<string>("");

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);
  const [targetToDelete, setTargetToDelete] = useState<Passkey | null>(null);

  const fetchPasskeys = useCallback(async (): Promise<void> => {
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

  const handleOpenAdd = (): void => {
    setPasskeyName("");
    setAddError("");
    setNameFocused(false);
    setIsAddOpen(true);
  };

  const handleRegister = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = passkeyName.trim();
    if (!validatePasskeyName(trimmed)) {
      setAddError(
        t(
          "account.passkey.formatTip",
          "1-30 characters, letters, numbers, hyphens and underscores allowed"
        )
      );
      return;
    }

    setRegistering(true);
    setAddError("");

    try {
      const options = await getPasskeyRegistrationOptions();
      const credential = await startPasskeyRegistration(options);
      const res = await verifyPasskeyRegistration({
        name: trimmed,
        credential
      });

      const passkeyId = (res as any)?.passkey?.id || (res as any)?.id;
      if (passkeyId && e2ee.isUnlocked()) {
        try {
          await e2ee.wrapCurrentKeyForPasskey(passkeyId);
        } catch (wrapErr) {
          console.warn("[Passkeys] Failed to wrap existing E2EE key for new passkey:", wrapErr);
        }
      }

      setIsAddOpen(false);
      setPasskeyName("");
      await fetchPasskeys();
      onRefresh?.();
      if (res?.recovery_keys && res.recovery_keys.length > 0) {
        setRecoveryKeys(res.recovery_keys);
      }
    } catch (err: unknown) {
      console.error("Passkey registration failed:", err);
      const msg =
        err instanceof Error
          ? err.message
          : t("account.passkey.regFailed", "Registration failed");
      setAddError(msg);
    } finally {
      setRegistering(false);
    }
  };

  const handleCopyRecoveryKeys = (): void => {
    if (!recoveryKeys) return;
    navigator.clipboard.writeText(recoveryKeys.join("\n")).then(() => {
      setCopiedKeys(true);
      setTimeout(() => setCopiedKeys(false), 2000);
    });
  };

  const handleOpenRename = (pk: Passkey): void => {
    setEditingPasskey(pk);
    setEditName(pk.name);
    setRenameError("");
    setRenameFocused(false);
  };

  const handleRenameSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    const trimmed = editName.trim();
    if (!editingPasskey || !trimmed) return;
    if (!validatePasskeyName(trimmed)) {
      setRenameError(
        t(
          "account.passkey.formatTip",
          "1-30 characters, letters, numbers, hyphens and underscores allowed"
        )
      );
      return;
    }

    setRenaming(true);
    setRenameError("");
    try {
      await renamePasskey(editingPasskey.id, trimmed);
      setEditingPasskey(null);
      await fetchPasskeys();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t("common.errorNetwork");
      setRenameError(msg);
    } finally {
      setRenaming(false);
    }
  };

  const handleOpenDelete = (pk: Passkey): void => {
    setTargetToDelete(pk);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteSubmit = async (): Promise<void> => {
    if (!targetToDelete) return;
    setDeletingId(targetToDelete.id);
    try {
      await deletePasskey(targetToDelete.id);
      setDeleteConfirmOpen(false);
      setTargetToDelete(null);
      await fetchPasskeys();
      onRefresh?.();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : t("common.errorNetwork");
      alert(msg);
    } finally {
      setDeletingId(null);
    }
  };

  const handleTestPasskey = async (pk?: Passkey): Promise<void> => {
    const idToSet = pk ? pk.id : "all";
    setTestingId(idToSet);
    try {
      const result = await testPasskey(pk?.id);
      if (result.success) {
        toasterRef?.current?.show({
          message: t("account.passkey.testSuccess", {
            name: result.passkey?.name || pk?.name || "",
            defaultValue: `Passkey verified successfully: ${result.passkey?.name || pk?.name || ""}`
          }),
          intent: Intent.SUCCESS,
          icon: "tick-circle"
        });
        await fetchPasskeys();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("cancelled") ||
        msg.includes("NotAllowedError") ||
        msg.includes("timed out") ||
        msg.includes("abort")
      ) {
        toasterRef?.current?.show({
          message: t("account.passkey.testCancelled", "Passkey verification cancelled"),
          intent: Intent.WARNING,
          icon: "warning-sign"
        });
      } else {
        toasterRef?.current?.show({
          message: msg || t("account.passkey.testFailed", "Passkey verification failed"),
          intent: Intent.DANGER,
          icon: "error"
        });
      }
    } finally {
      setTestingId(null);
    }
  };

  return {
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
    handleTestPasskey,
    fetchPasskeys
  };
};
