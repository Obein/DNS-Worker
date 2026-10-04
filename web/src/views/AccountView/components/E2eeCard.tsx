import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Card,
  Elevation,
  H4,
  H5,
  Switch,
  Button,
  Intent,
  Tag,
  Callout,
  Alert,
  OverlayToaster,
  Spinner,
  Divider,
  Dialog,
  Classes,
  InputGroup,
  FormGroup,
  PopoverNext,
} from "@blueprintjs/core";
import {
  Lock,
  ShieldCheck,
  KeyRound,
  RefreshCw,
  Key,
  Copy,
  Check,
  ShieldAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { e2ee } from "../../../services";
import type { ProfileE2eeStatus } from "../../../services";
import { rotateRecoveryKey } from "../../../services/account";

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

  const [status, setStatus] = useState<ProfileE2eeStatus | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [processing, setProcessing] = useState<boolean>(false);
  const [isDisableAlertOpen, setIsDisableAlertOpen] = useState<boolean>(false);
  const [isUnlocked, setIsUnlocked] = useState<boolean>(false);

  // Recovery Key unlock dialog state
  const [isRecoveryDialogOpen, setIsRecoveryDialogOpen] = useState<boolean>(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState<string>("");
  const [recoveryUnlockError, setRecoveryUnlockError] = useState<string>("");

  // Recovery Key init keypair dialog state (for existing users with no keys)
  const [initRecoveryDialogOpen, setInitRecoveryDialogOpen] = useState<boolean>(false);
  const [initRecoveryKeyInput, setInitRecoveryKeyInput] = useState<string>("");
  const [initRecoveryError, setInitRecoveryError] = useState<string>("");

  // Auto-rotated recovery key modal state
  const [rotatedKey, setRotatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);

  // 1. Load account-wide E2EE status
  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await e2ee.getUserStatus();
      setStatus(data);
      setIsUnlocked(e2ee.isUnlocked());
    } catch (err) {
      console.error("[E2eeCard] Failed to fetch E2EE status:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const hasPasskey = (user.passkeys_count && user.passkeys_count > 0) || (status?.userPasskeyCount || 0) > 0;
  const isLogsE2eeEnabled = Boolean(status?.enabled);

  // 2. Handle toggle for DNS Query Logs encryption across user account
  const handleToggleLogs = async (checked: boolean) => {
    if (checked) {
      setProcessing(true);
      try {
        await e2ee.enableUserE2ee();
        toasterRef.current?.show({
          message: t("account.e2ee.enableSuccess"),
          intent: Intent.SUCCESS,
          icon: "lock",
        });
        await loadStatus();
        onRefresh?.();
      } catch (err: any) {
        console.error("[E2eeCard] Failed to enable E2EE:", err);
        toasterRef.current?.show({
          message: err.message || t("account.e2ee.enableError"),
          intent: Intent.DANGER,
          icon: "error",
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
        icon: "unlock",
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: any) {
      console.error("[E2eeCard] Failed to disable E2EE:", err);
      toasterRef.current?.show({
        message: err.message || t("account.e2ee.disableError"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
      setIsDisableAlertOpen(false);
    }
  };

  // 3. Handle Passkey unlock on this device
  const handleUnlock = async () => {
    setProcessing(true);
    try {
      const success = await e2ee.unlockUser();
      if (success) {
        setIsUnlocked(true);
        toasterRef.current?.show({
          message: t("account.e2ee.unlockSuccess"),
          intent: Intent.SUCCESS,
          icon: "tick",
        });
      }
    } catch (err: any) {
      console.error("[E2eeCard] Failed to unlock private key:", err);
      toasterRef.current?.show({
        message: err.message || t("account.e2ee.unlockError"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
    }
  };

  // 4. Handle Recovery Key unlock (Single-use auto-rotation)
  const handleUnlockWithRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = recoveryKeyInput.trim();
    if (!key) return;

    setProcessing(true);
    setRecoveryUnlockError("");
    try {
      await e2ee.unlockWithRecoveryKey(key);

      // Auto-rotate the Recovery Key immediately upon use
      try {
        const rotateRes = await rotateRecoveryKey({ recoveryKey: key });
        await e2ee.wrapCurrentKeyForRecovery(rotateRes.recovery_key);
        setRotatedKey(rotateRes.recovery_key);
      } catch (rotateErr) {
        console.warn("[E2eeCard] Recovery key auto-rotation failed:", rotateErr);
      }

      setIsUnlocked(true);
      setIsRecoveryDialogOpen(false);
      setRecoveryKeyInput("");
      toasterRef.current?.show({
        message: t("account.e2ee.unlockSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: any) {
      console.error("[E2eeCard] Recovery unlock failed:", err);
      setRecoveryUnlockError(err.message || t("account.e2ee.recoveryUnlockFailed"));
    } finally {
      setProcessing(false);
    }
  };

  // 5. Handle keypair generation with existing Passkey
  const handleGenerateKeyWithPasskey = async () => {
    setProcessing(true);
    try {
      await e2ee.enableUserE2ee();
      toasterRef.current?.show({
        message: t("account.e2ee.keypairGenSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: any) {
      console.error("[E2eeCard] Generate key with Passkey failed:", err);
      toasterRef.current?.show({
        message: err.message || t("account.e2ee.keypairGenError"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setProcessing(false);
    }
  };

  // 6. Handle keypair generation with Recovery Key (Single-use auto-rotation)
  const handleInitWithRecoveryKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = initRecoveryKeyInput.trim();
    if (!key) return;

    setProcessing(true);
    setInitRecoveryError("");
    try {
      await e2ee.initUserE2eeWithRecoveryKey(key);

      // Auto-rotate recovery key immediately upon use
      try {
        const rotateRes = await rotateRecoveryKey({ recoveryKey: key });
        await e2ee.wrapCurrentKeyForRecovery(rotateRes.recovery_key);
        setRotatedKey(rotateRes.recovery_key);
      } catch (rotateErr) {
        console.warn("[E2eeCard] Recovery key auto-rotation failed:", rotateErr);
      }

      setInitRecoveryDialogOpen(false);
      setInitRecoveryKeyInput("");
      setIsUnlocked(true);
      toasterRef.current?.show({
        message: t("account.e2ee.keypairGenSuccess"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      await loadStatus();
      onRefresh?.();
    } catch (err: any) {
      console.error("[E2eeCard] Init keypair with recovery key failed:", err);
      setInitRecoveryError(err.message || t("account.e2ee.initFailed"));
    } finally {
      setProcessing(false);
    }
  };

  const handleCopyRotatedKey = (k: string) => {
    navigator.clipboard.writeText(k);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <Card elevation={Elevation.ONE} className="space-y-6">
      <OverlayToaster ref={toasterRef} />

      <div>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lock
              size={20}
              className={isLogsE2eeEnabled ? "text-emerald-500" : "text-gray-400"}
            />
            <H4 style={{ margin: 0 }}>
              {t("account.e2ee.title", "E2EE")}
            </H4>
            <Tag
              intent={isLogsE2eeEnabled ? Intent.SUCCESS : Intent.NONE}
              minimal
              round
            >
              {isLogsE2eeEnabled
                ? t("account.e2ee.enabled")
                : t("account.e2ee.disabled")}
            </Tag>
          </div>
          <PopoverNext
            placement="bottom-end"
            usePortal={true}
            content={
              <div className="p-4 max-w-sm">
                <H5>{t("account.e2ee.trustBoundaryTitle")}</H5>
                <p className="text-sm text-gray-700 dark:text-gray-300 m-0">
                  {t(
                    "account.e2ee.trustBoundaryDesc", "All DNS query traffic inevitably passes through the hosting server (Cloudflare Workers edge nodes or self-hosted server runtime) during resolution, where queries are processed in memory before being encrypted and saved. This feature strictly protects data at rest in the cloud database (D1 / persistent storage) from data leaks or offline analysis; it does not conceal active network traffic from the hosting server processing the request."
                  )}
                </p>
              </div>
            }
          >
            <Button icon="help" variant="minimal" intent={Intent.NONE} />
          </PopoverNext>
        </div>

        {/* Global Description */}
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          {t(
            "account.e2ee.desc"
          )}
        </p>

        {loading ? (
          <div className="flex items-center justify-center p-6">
            <Spinner size={20} />
          </div>
        ) : !status?.hasKeys ? (
          /* Prompt for existing users without keypairs */
          <Callout intent={Intent.PRIMARY} icon="shield" className="my-3 text-xs">
            <div className="space-y-3">
              <div>
                <h5 className="font-semibold text-sm mb-1 text-blue-900 dark:text-blue-100">
                  {t("account.e2ee.noKeypairTitle")}
                </h5>
                <p className="text-xs text-blue-800 dark:text-blue-200 m-0">
                  {t(
                    "account.e2ee.noKeypairDesc"
                  )}
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap pt-1">
                {hasPasskey ? (
                  <Button
                    intent={Intent.PRIMARY}
                    small
                    icon={<KeyRound size={14} />}
                    text={t("account.e2ee.initPasskeyBtn")}
                    loading={processing}
                    onClick={handleGenerateKeyWithPasskey}
                  />
                ) : (
                  <Button
                    intent={Intent.PRIMARY}
                    small
                    icon={<Key size={14} />}
                    text={t("account.e2ee.addPasskeyBtn")}
                    onClick={() => {
                      document.getElementById("passkeys-section")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  />
                )}

                <Button
                  intent={Intent.NONE}
                  small
                  icon={<Key size={14} />}
                  text={t("account.e2ee.initRecoveryBtn")}
                  onClick={() => {
                    setInitRecoveryError("");
                    setInitRecoveryKeyInput("");
                    setInitRecoveryDialogOpen(true);
                  }}
                />
              </div>
            </div>
          </Callout>
        ) : (
          <div className="space-y-4">
            <Divider className="my-2" />

            {/* Direct Master Switch Card */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/50">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                    {t("account.e2ee.enableSwitch")}
                  </span>
                  <Tag
                    intent={isLogsE2eeEnabled ? Intent.SUCCESS : Intent.NONE}
                    minimal
                    round
                  >
                    {isLogsE2eeEnabled
                      ? t("account.e2ee.enabled")
                      : t("account.e2ee.disabled")}
                  </Tag>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 m-0">
                  {t(
                    "account.e2ee.enableSwitchDesc"
                  )}
                </p>
              </div>
              <div className="shrink-0 flex items-center">
                <Switch
                  checked={isLogsE2eeEnabled}
                  disabled={processing || loading}
                  onChange={(e) => handleToggleLogs(e.currentTarget.checked)}
                  large
                  className="mb-0"
                />
              </div>
            </div>

            {/* Hardware Key & Device Status (shown when keypair exists) */}
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800/80 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="opacity-70 flex items-center gap-1.5">
                  <KeyRound size={13} />
                  {t("account.e2ee.keyType")}:
                </span>
                <span className="font-mono">ECDH P-256 + AES-256-GCM</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="opacity-70 flex items-center gap-1.5">
                  <ShieldCheck size={13} />
                  {t("account.e2ee.deviceState")}:
                </span>
                {isUnlocked ? (
                  <Tag minimal intent={Intent.SUCCESS} className="text-[10px]">
                    {t("account.e2ee.unlocked")}
                  </Tag>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap justify-end">
                    {hasPasskey && (
                      <Button
                        small
                        minimal
                        intent={Intent.PRIMARY}
                        icon={<RefreshCw size={12} />}
                        text={t("account.e2ee.unlockButton")}
                        loading={processing}
                        onClick={handleUnlock}
                      />
                    )}
                    <Button
                      small
                      minimal
                      intent={Intent.NONE}
                      icon={<KeyRound size={12} />}
                      text={t("account.e2ee.unlockRecoveryButton")}
                      onClick={() => {
                        setRecoveryUnlockError("");
                        setRecoveryKeyInput("");
                        setIsRecoveryDialogOpen(true);
                      }}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">
                <span className="opacity-70">
                  {t("account.e2ee.protectedPasskeys")}:
                </span>
                <span className="font-mono">
                  {status?.wrappedPasskeys?.length || 0}{" "}
                  {t("account.e2ee.devicesUnit")}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Alert for Disabling E2EE */}
      <Alert
        isOpen={isDisableAlertOpen}
        confirmButtonText={t("common.confirmDisable")}
        cancelButtonText={t("common.cancel")}
        intent={Intent.DANGER}
        icon="unlock"
        onConfirm={handleConfirmDisable}
        onCancel={() => setIsDisableAlertOpen(false)}
        loading={processing}
      >
        <p>
          {t(
            "account.e2ee.disableConfirm"
          )}
        </p>
      </Alert>

      {/* Recovery Key Unlock Dialog */}
      <Dialog
        isOpen={isRecoveryDialogOpen}
        onClose={() => setIsRecoveryDialogOpen(false)}
        title={t("account.e2ee.unlockWithRecoveryTitle")}
        icon="key"
        className="dark:bg-gray-900"
      >
        <form onSubmit={handleUnlockWithRecoveryKey}>
          <div className={Classes.DIALOG_BODY}>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {t(
                "account.e2ee.unlockWithRecoveryDesc"
              )}
            </p>
            {recoveryUnlockError && (
              <Callout intent={Intent.DANGER} className="mb-3 text-xs">
                {recoveryUnlockError}
              </Callout>
            )}
            <FormGroup
              label={t("account.e2ee.recoveryKeyInputLabel")}
              labelFor="recovery-key-input"
            >
              <InputGroup
                id="recovery-key-input"
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
              <Button onClick={() => setIsRecoveryDialogOpen(false)} text={t("common.cancel")} />
              <Button
                type="submit"
                intent={Intent.PRIMARY}
                loading={processing}
                disabled={!recoveryKeyInput.trim()}
                text={t("account.e2ee.unlockConfirm")}
              />
            </div>
          </div>
        </form>
      </Dialog>

      {/* Init Keypair with Recovery Key Dialog */}
      <Dialog
        isOpen={initRecoveryDialogOpen}
        onClose={() => setInitRecoveryDialogOpen(false)}
        title={t("account.e2ee.initWithRecoveryTitle")}
        icon="key"
        className="dark:bg-gray-900"
      >
        <form onSubmit={handleInitWithRecoveryKey}>
          <div className={Classes.DIALOG_BODY}>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
              {t(
                "account.e2ee.initWithRecoveryDesc"
              )}
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
              <Button onClick={() => setInitRecoveryDialogOpen(false)} text={t("common.cancel")} />
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

      {/* Rotated Recovery Key Notification Modal */}
      <Dialog
        isOpen={!!rotatedKey}
        onClose={() => setRotatedKey(null)}
        title={t("account.recoveryKey.autoRotatedTitle")}
        icon="warning-sign"
        isCloseButtonShown={false}
        canOutsideClickClose={false}
        className="dark:bg-gray-900"
      >
        <div className={Classes.DIALOG_BODY}>
          <Callout intent={Intent.WARNING} icon={<ShieldAlert size={16} />} className="mb-4 text-xs">
            {t(
              "account.recoveryKey.autoRotatedNotice"
            )}
          </Callout>

          {rotatedKey && (
            <div className="space-y-3">
              <div className="p-3 bg-gray-100 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 font-mono text-center text-lg font-bold tracking-widest select-all text-gray-900 dark:text-gray-100">
                {rotatedKey}
              </div>
              <div className="flex justify-center">
                <Button
                  intent={Intent.PRIMARY}
                  icon={copiedKey ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  text={copiedKey ? t("common.copied") : t("common.copyKey")}
                  onClick={() => handleCopyRotatedKey(rotatedKey)}
                />
              </div>
            </div>
          )}
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button
              intent={Intent.SUCCESS}
              onClick={() => setRotatedKey(null)}
              text={t("account.recoveryKey.savedAndClose")}
            />
          </div>
        </div>
      </Dialog>
    </Card>
  );
};
