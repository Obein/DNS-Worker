/**
 * @file useE2eeCardState.ts
 * @description Composed state coordinator hook for E2EE settings card UI.
 */

import { useState } from "react";
import { OverlayToaster } from "@blueprintjs/core";
import type { UserInfo } from "../../../types";
import { useE2eeStatus } from "./useE2eeStatus";
import { useE2eeRecoveryDialogs } from "./useE2eeRecoveryDialogs";
import { useE2eeActions } from "./useE2eeActions";

export interface UseE2eeCardStateProps {
  user: UserInfo;
  onRefresh?: () => void;
  toasterRef: React.RefObject<OverlayToaster | null>;
}

export function useE2eeCardState({
  user,
  onRefresh,
  toasterRef
}: UseE2eeCardStateProps) {
  const [processing, setProcessing] = useState<boolean>(false);

  const statusHook = useE2eeStatus({
    user,
    onRefresh,
    toasterRef,
    setProcessing
  });

  const recoveryHook = useE2eeRecoveryDialogs({
    onRefresh,
    loadStatus: statusHook.loadStatus,
    setIsUnlocked: statusHook.setIsUnlocked,
    toasterRef,
    setProcessing
  });

  const actionsHook = useE2eeActions({
    hasPasskey: statusHook.hasPasskey,
    onRefresh,
    loadStatus: statusHook.loadStatus,
    setIsUnlocked: statusHook.setIsUnlocked,
    setInitRecoveryDialogOpen: recoveryHook.setInitRecoveryDialogOpen,
    toasterRef,
    setProcessing
  });

  return {
    status: statusHook.status,
    loading: statusHook.loading,
    processing,
    isUnlocked: statusHook.isUnlocked,
    isPqc: statusHook.isPqc,
    isLogsE2eeEnabled: statusHook.isLogsE2eeEnabled,
    hasPasskey: statusHook.hasPasskey,
    isDisableAlertOpen: statusHook.isDisableAlertOpen,
    setIsDisableAlertOpen: statusHook.setIsDisableAlertOpen,
    isRecoveryDialogOpen: recoveryHook.isRecoveryDialogOpen,
    setIsRecoveryDialogOpen: recoveryHook.setIsRecoveryDialogOpen,
    recoveryKeyInput: recoveryHook.recoveryKeyInput,
    setRecoveryKeyInput: recoveryHook.setRecoveryKeyInput,
    recoveryUnlockError: recoveryHook.recoveryUnlockError,
    setRecoveryUnlockError: recoveryHook.setRecoveryUnlockError,
    initRecoveryDialogOpen: recoveryHook.initRecoveryDialogOpen,
    setInitRecoveryDialogOpen: recoveryHook.setInitRecoveryDialogOpen,
    initRecoveryKeyInput: recoveryHook.initRecoveryKeyInput,
    setInitRecoveryKeyInput: recoveryHook.setInitRecoveryKeyInput,
    initRecoveryError: recoveryHook.initRecoveryError,
    setInitRecoveryError: recoveryHook.setInitRecoveryError,
    rotatedKey: recoveryHook.rotatedKey,
    setRotatedKey: recoveryHook.setRotatedKey,
    copiedKey: recoveryHook.copiedKey,
    handleToggleLogs: statusHook.handleToggleLogs,
    handleConfirmDisable: statusHook.handleConfirmDisable,
    handleUnlock: actionsHook.handleUnlock,
    handleUnlockWithRecoveryKey: recoveryHook.handleUnlockWithRecoveryKey,
    handleGenerateKeyWithPasskey: actionsHook.handleGenerateKeyWithPasskey,
    handleUpgradeToPqc: actionsHook.handleUpgradeToPqc,
    handleInitWithRecoveryKey: recoveryHook.handleInitWithRecoveryKey,
    handleLockDevice: statusHook.handleLockDevice,
    handleCopyRotatedKey: recoveryHook.handleCopyRotatedKey,
    isResetAlertOpen: actionsHook.isResetAlertOpen,
    setIsResetAlertOpen: actionsHook.setIsResetAlertOpen,
    handleResetAndReinit: actionsHook.handleResetAndReinit,
    handleEnrollPasskey: actionsHook.handleEnrollPasskey
  };
}
