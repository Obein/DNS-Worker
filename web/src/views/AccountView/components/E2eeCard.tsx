import React, { useRef } from "react";
import {
  Card,
  Elevation,
  OverlayToaster,
  Spinner
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { useE2eeCardState } from "./e2ee/hooks/useE2eeCardState";
import { E2eeHeader } from "./e2ee/components/E2eeHeader";
import { InitKeyCallout } from "./e2ee/components/InitKeyCallout";
import { E2eeStatusSection } from "./e2ee/components/E2eeStatusSection";
import { DisableE2eeAlert } from "./e2ee/components/DisableE2eeAlert";
import { UnlockRecoveryDialog } from "./e2ee/components/UnlockRecoveryDialog";
import { InitRecoveryDialog } from "./e2ee/components/InitRecoveryDialog";
import { RotatedKeyAlert } from "./e2ee/components/RotatedKeyAlert";

export interface E2eeCardProps {
  /** The current user profile and security state. */
  user: UserInfo;
  /** Callback triggered to re-fetch the latest user data. */
  onRefresh?: () => void;
}

/**
 * E2eeCard manages Account-Level End-to-End Encryption (E2EE).
 * Provides hardware Passkey envelope encryption for DNS query logs.
 * Directly toggles query logs encryption without scope selection.
 */
export const E2eeCard: React.FC<E2eeCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();
  const toasterRef = useRef<OverlayToaster | null>(null);

  const {
    status,
    loading,
    processing,
    isUnlocked,
    isPqc,
    isLogsE2eeEnabled,
    hasPasskey,
    isDisableAlertOpen,
    setIsDisableAlertOpen,
    isRecoveryDialogOpen,
    setIsRecoveryDialogOpen,
    recoveryKeyInput,
    setRecoveryKeyInput,
    recoveryUnlockError,
    initRecoveryDialogOpen,
    setInitRecoveryDialogOpen,
    initRecoveryKeyInput,
    setInitRecoveryKeyInput,
    initRecoveryError,
    setInitRecoveryError,
    rotatedKey,
    setRotatedKey,
    copiedKey,
    handleToggleLogs,
    handleConfirmDisable,
    handleUnlock,
    handleUnlockWithRecoveryKey,
    handleGenerateKeyWithPasskey,
    handleUpgradeToPqc,
    handleInitWithRecoveryKey,
    handleLockDevice,
    handleCopyRotatedKey
  } = useE2eeCardState({ user, onRefresh, toasterRef });

  return (
    <Card elevation={Elevation.ONE} className="space-y-6">
      <OverlayToaster ref={toasterRef} />

      <div>
        {/* Header */}
        <E2eeHeader isLogsE2eeEnabled={isLogsE2eeEnabled} />

        {/* Global Description */}
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {t("account.e2ee.desc")}
        </p>

        {loading ? (
          <div className="flex items-center justify-center p-6">
            <Spinner size={20} />
          </div>
        ) : !status?.hasKeys ? (
          /* Prompt for existing users without keypairs */
          <InitKeyCallout
            hasPasskey={hasPasskey}
            processing={processing}
            onGenerateKeyWithPasskey={handleGenerateKeyWithPasskey}
            onOpenInitRecoveryDialog={() => {
              setInitRecoveryError("");
              setInitRecoveryKeyInput("");
              setInitRecoveryDialogOpen(true);
            }}
          />
        ) : (
          <E2eeStatusSection
            status={status}
            isLogsE2eeEnabled={isLogsE2eeEnabled}
            isUnlocked={isUnlocked}
            isPqc={isPqc}
            hasPasskey={hasPasskey}
            processing={processing}
            loading={loading}
            onToggleLogs={handleToggleLogs}
            onUpgradeToPqc={handleUpgradeToPqc}
            onLockDevice={handleLockDevice}
            onUnlockPasskey={handleUnlock}
            onOpenRecoveryUnlockDialog={() => {
              setRecoveryKeyInput("");
              setIsRecoveryDialogOpen(true);
            }}
          />
        )}
      </div>

      {/* Confirmation Alert for Disabling E2EE */}
      <DisableE2eeAlert
        isOpen={isDisableAlertOpen}
        processing={processing}
        onConfirm={handleConfirmDisable}
        onCancel={() => setIsDisableAlertOpen(false)}
      />

      {/* Recovery Key Unlock Dialog */}
      <UnlockRecoveryDialog
        isOpen={isRecoveryDialogOpen}
        onClose={() => setIsRecoveryDialogOpen(false)}
        recoveryKeyInput={recoveryKeyInput}
        setRecoveryKeyInput={setRecoveryKeyInput}
        recoveryUnlockError={recoveryUnlockError}
        processing={processing}
        onSubmit={handleUnlockWithRecoveryKey}
      />

      {/* Init Keypair with Recovery Key Dialog */}
      <InitRecoveryDialog
        isOpen={initRecoveryDialogOpen}
        onClose={() => setInitRecoveryDialogOpen(false)}
        initRecoveryKeyInput={initRecoveryKeyInput}
        setInitRecoveryKeyInput={setInitRecoveryKeyInput}
        initRecoveryError={initRecoveryError}
        processing={processing}
        onSubmit={handleInitWithRecoveryKey}
      />

      {/* Rotated Recovery Key Notification Modal */}
      <RotatedKeyAlert
        rotatedKey={rotatedKey}
        onClose={() => setRotatedKey(null)}
        copiedKey={copiedKey}
        onCopyKey={handleCopyRotatedKey}
      />
    </Card>
  );
};
