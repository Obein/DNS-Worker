/**
 * @file useE2eeStatus.ts
 * @description Hook managing core E2EE profile status, unlock flag, and enable/disable toggling.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Intent, OverlayToaster } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../../../types";
import { e2ee } from "../../../../../services";
import type { ProfileE2eeStatus } from "../../../../../services";

export interface UseE2eeStatusProps {
  user: UserInfo;
  onRefresh?: () => void;
  toasterRef: React.RefObject<OverlayToaster | null>;
  setProcessing: (val: boolean) => void;
}

export function useE2eeStatus({
  user,
  onRefresh,
  toasterRef,
  setProcessing
}: UseE2eeStatusProps) {
  const { t } = useTranslation();

  const [status, setStatus] = useState<ProfileE2eeStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);
  const [isDisableAlertOpen, setIsDisableAlertOpen] = useState<boolean>(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await e2ee.getUserStatus();
      setStatus(data);
      setIsUnlocked(e2ee.isUnlocked());
    } catch (err) {
      console.error("[useE2eeStatus] Failed to fetch E2EE status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const hasPasskey =
    (user.passkeys_count && user.passkeys_count > 0) ||
    (status?.userPasskeyCount || 0) > 0;
  const isLogsE2eeEnabled = Boolean(status?.enabled);

  const isPqc = useMemo(() => {
    if (!status?.publicKey) return false;
    try {
      const parsed = JSON.parse(status.publicKey);
      return parsed.alg === "P256-MLKEM768" || Boolean(parsed.pqc_pk);
    } catch {
      return false;
    }
  }, [status?.publicKey]);

  const handleToggleLogs = async (checked: boolean) => {
    if (checked) {
      setProcessing(true);
      try {
        await e2ee.enableUserE2ee();
        toasterRef.current?.show({
          message: t("account.e2ee.enableSuccess"),
          intent: Intent.SUCCESS,
          icon: "lock"
        });
        await loadStatus();
        onRefresh?.();
      } catch (err: unknown) {
        console.error("[useE2eeStatus] Failed to enable E2EE:", err);
        toasterRef.current?.show({
          message: (err as Error).message || t("account.e2ee.enableError"),
          intent: Intent.DANGER,
          icon: "error"
        });
      } finally {
        setProcessing(false);
      }
    } else {
      setIsDisableAlertOpen(true);
    }
  };

  const handleConfirmDisable = async () => {
    setProcessing(true);
    try {
      await e2ee.disableUserE2ee();
      toasterRef.current?.show({
        message: t("account.e2ee.disableSuccess"),
        intent: Intent.WARNING,
        icon: "unlock"
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: unknown) {
      console.error("[useE2eeStatus] Failed to disable E2EE:", err);
      toasterRef.current?.show({
        message: (err as Error).message || t("account.e2ee.disableError"),
        intent: Intent.DANGER,
        icon: "error"
      });
    } finally {
      setProcessing(false);
      setIsDisableAlertOpen(false);
    }
  };

  const handleLockDevice = () => {
    e2ee.clearStorage();
    setIsUnlocked(false);
    toasterRef.current?.show({
      message: t("account.e2ee.lockSuccess", "已锁定，私钥已从本地清除"),
      intent: Intent.NONE
    });
  };

  return {
    status,
    loading,
    isUnlocked,
    setIsUnlocked,
    isPqc,
    isLogsE2eeEnabled,
    hasPasskey,
    loadStatus,
    isDisableAlertOpen,
    setIsDisableAlertOpen,
    handleToggleLogs,
    handleConfirmDisable,
    handleLockDevice
  };
}
