/**
 * @file useE2eeActions.ts
 * @description Hook managing E2EE keypair lifecycle actions (unlock, upgrade PQC, enroll passkey, reset & reinit).
 */

import { useState } from "react";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { e2ee } from "../../../../../services";
import { getPasskeys } from "../../../../../services/account";

export interface UseE2eeActionsProps {
  hasPasskey: boolean;
  onRefresh?: () => void;
  loadStatus: () => Promise<void>;
  setIsUnlocked: (val: boolean) => void;
  setInitRecoveryDialogOpen: (val: boolean) => void;
  toasterRef: React.RefObject<OverlayToaster | null>;
  setProcessing: (val: boolean) => void;
}

export function useE2eeActions({
  hasPasskey,
  onRefresh,
  loadStatus,
  setIsUnlocked,
  setInitRecoveryDialogOpen,
  toasterRef,
  setProcessing
}: UseE2eeActionsProps) {
  const { t } = useTranslation();
  const [isResetAlertOpen, setIsResetAlertOpen] = useState<boolean>(false);

  const handleUnlock = async () => {
    setProcessing(true);
    try {
      const success = await e2ee.unlockUser();
      if (success) {
        setIsUnlocked(true);
        toasterRef.current?.show({
          message: t("account.e2ee.unlockSuccess"),
          intent: Intent.SUCCESS,
          icon: "tick"
        });
      }
    } catch (err: unknown) {
      console.error("[useE2eeActions] Failed to unlock private key:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.unlockError"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleGenerateKeyWithPasskey = async () => {
    setProcessing(true);
    try {
      await e2ee.enableUserE2ee();
      toasterRef.current?.show({
        message: t("account.e2ee.keypairGenSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeActions] Generate key with Passkey failed:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.keypairGenError"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleUpgradeToPqc = async () => {
    setProcessing(true);
    try {
      await e2ee.rotateUserE2eeKey();
      toasterRef.current?.show({
        message: t("account.e2ee.upgradePqcSuccess", "已成功升级到后量子混合加密 (P256-MLKEM768)"),
        intent: Intent.SUCCESS,
        icon: "tick"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeActions] Upgrade to PQC failed:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.upgradePqcError", "升级到后量子加密失败"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleEnrollPasskey = async () => {
    setProcessing(true);
    try {
      const passkeys = await getPasskeys();
      const passkeyId = passkeys.length > 0 ? passkeys[0].id : "primary";
      const success = await e2ee.wrapCurrentKeyForPasskey(passkeyId);
      if (success) {
        toasterRef.current?.show({
          message: t("account.e2ee.enrollPasskeySuccess", "已成功将通行密钥关联至端到端加密！"),
          intent: Intent.SUCCESS,
          icon: "tick"
        });
        await loadStatus();
        onRefresh?.();
      } else {
        throw new Error(t("account.e2ee.enrollPasskeyFailed", "关联通行密钥失败"));
      }
    } catch (err: unknown) {
      console.error("[useE2eeActions] Enroll passkey failed:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.enrollPasskeyFailed", "关联通行密钥失败"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
    }
  };

  const handleResetAndReinit = async () => {
    setProcessing(true);
    try {
      await fetch("/api/account/e2ee?purge=true", { method: "DELETE" });
      e2ee.clearStorage();

      if (hasPasskey) {
        await e2ee.enableUserE2ee();
        toasterRef.current?.show({
          message: t("account.e2ee.resetAndInitPasskeySuccess", "密钥对已成功重置并使用通行密钥重新加密！"),
          intent: Intent.SUCCESS,
          icon: "tick"
        });
      } else {
        toasterRef.current?.show({
          message: t("account.e2ee.resetSuccessEnterRecovery", "旧密钥已清除，请使用恢复密钥初始化新密钥对。"),
          intent: Intent.WARNING,
          icon: "refresh"
        });
        setInitRecoveryDialogOpen(true);
      }
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeActions] Reset keypair failed:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.resetFailed", "重置密钥对失败"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
      setIsResetAlertOpen(false);
    }
  };

  return {
    handleUnlock,
    handleGenerateKeyWithPasskey,
    handleUpgradeToPqc,
    handleEnrollPasskey,
    isResetAlertOpen,
    setIsResetAlertOpen,
    handleResetAndReinit
  };
}
