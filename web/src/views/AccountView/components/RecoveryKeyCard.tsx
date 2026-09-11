import React, { useState } from "react";
import {
  Card,
  Elevation,
  H4,
  Tag,
  Intent,
  Button,
  Callout,
  Alert,
  Tooltip,
  Position
} from "@blueprintjs/core";
import { Key, Lock, RefreshCw, Eye, EyeOff, Copy, Check, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { VerifyIdentityDialog } from "./VerifyIdentityDialog";
import {
  viewRecoveryKeys,
  rotateRecoveryKey,
  type VerifyIdentityPayload
} from "../../../services/account";

export interface RecoveryKeyCardProps {
  user: UserInfo;
  onRefresh: () => void;
}

export const RecoveryKeyCard: React.FC<RecoveryKeyCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [verifyMode, setVerifyMode] = useState<"view" | "rotate">("view");
  const [confirmRotateOpen, setConfirmRotateOpen] = useState(false);

  const [displayedKeys, setDisplayedKeys] = useState<string[] | null>(null);
  const [isLegacy, setIsLegacy] = useState(false);
  const [isMasked, setIsMasked] = useState(true);
  const [copied, setCopied] = useState(false);

  const [cardMessage, setCardMessage] = useState<{ text: string; intent: Intent } | null>(null);

  const hasRecoveryKeys = !!(user.has_recovery_keys || user.recovery_keys_encrypted);
  const isKekProtected = !!user.recovery_keys_encrypted;

  const handleStartView = () => {
    setCardMessage(null);
    setVerifyMode("view");
    setIsMasked(true);
    setVerifyDialogOpen(true);
  };

  const handleStartRotate = () => {
    setCardMessage(null);
    setConfirmRotateOpen(true);
  };

  const handleConfirmRotate = () => {
    setConfirmRotateOpen(false);
    setVerifyMode("rotate");
    setVerifyDialogOpen(true);
  };

  const handleVerifySubmit = async (payload: VerifyIdentityPayload) => {
    if (verifyMode === "view") {
      const res = await viewRecoveryKeys(payload);
      if (res.is_legacy && (!res.recovery_keys || res.recovery_keys.length === 0)) {
        setIsLegacy(true);
        setDisplayedKeys(null);
        setCardMessage({
          text: t(
            "account.recoveryKey.legacyNotice",
            "Your recovery key is stored as a legacy one-way hash and cannot be decrypted for display. Please rotate your recovery key to generate a new KEK envelope-encrypted key."
          ),
          intent: Intent.WARNING
        });
      } else {
        setIsLegacy(false);
        setDisplayedKeys(res.recovery_keys);
        setIsMasked(true);
      }
    } else if (verifyMode === "rotate") {
      const res = await rotateRecoveryKey(payload);
      setDisplayedKeys([res.recovery_key]);
      setIsLegacy(false);
      setIsMasked(false);
      setCardMessage({
        text: t(
          "account.recoveryKey.rotateSuccess",
          "Recovery key rotated successfully! Please store your new key in a safe place immediately."
        ),
        intent: Intent.SUCCESS
      });
      onRefresh();
    }
  };

  const handleCopy = (keyText: string) => {
    navigator.clipboard.writeText(keyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Key size={18} className="text-amber-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.recoveryKey.title", "Emergency Recovery Key")}
          </H4>
          <Tag intent={hasRecoveryKeys ? Intent.SUCCESS : Intent.NONE} minimal round>
            {hasRecoveryKeys
              ? t("account.recoveryKey.configured", "Configured")
              : t("account.recoveryKey.notConfigured", "Not Configured")}
          </Tag>
          {isKekProtected && (
            <Tooltip
              content={t(
                "account.recoveryKey.kekTooltip",
                "Protected with AES-256-GCM Envelope Encryption backed by Key Encryption Key (KEK)."
              )}
              position={Position.TOP}
            >
              <Tag
                intent={Intent.SUCCESS}
                minimal
                round
                icon={<Lock size={12} style={{ display: "inline-flex", alignItems: "center", marginRight: "4px" }} />}
              >
                {t("account.recoveryKey.kekProtected", "KEK Encrypted")}
              </Tag>
            </Tooltip>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasRecoveryKeys && (
            <Button
              small
              icon={<Eye size={14} />}
              text={t("account.recoveryKey.viewBtn", "View Recovery Key")}
              onClick={handleStartView}
            />
          )}
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t(
          "account.recoveryKey.desc",
          "An emergency recovery key allows you to regain access or reset your password if you lose all registered Passkeys or Authenticator Apps. Store it securely offline."
        )}
      </p>

      {cardMessage && (
        <Callout intent={cardMessage.intent} className="my-2">
          {cardMessage.text}
        </Callout>
      )}

      {isLegacy && (
        <Callout intent={Intent.WARNING} icon={<ShieldAlert size={16} />} className="my-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span>
              {t(
                "account.recoveryKey.legacyNotice",
                "Your recovery key is stored as a legacy one-way hash and cannot be decrypted for display. Please rotate your recovery key to generate a new KEK envelope-encrypted key."
              )}
            </span>
            <Button
              small
              intent={Intent.WARNING}
              icon={<RefreshCw size={14} />}
              text={t("account.recoveryKey.rotateBtn", "Rotate Key")}
              onClick={handleStartRotate}
              className="shrink-0"
            />
          </div>
        </Callout>
      )}

      {/* Displayed Key Card */}
      {displayedKeys && displayedKeys.length > 0 && (
        <Card elevation={Elevation.ZERO} className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {t("account.recoveryKey.yourKey", "Your 30-Digit Recovery Key")}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                small
                minimal
                intent={Intent.WARNING}
                icon={<RefreshCw size={14} />}
                text={t("account.recoveryKey.rotateBtn", "Rotate Key")}
                onClick={handleStartRotate}
              />
              <div className="h-4 w-px bg-gray-300 dark:bg-gray-600 mx-1 hidden sm:block" />
              <Button
                minimal
                small
                icon={isMasked ? <Eye size={14} /> : <EyeOff size={14} />}
                onClick={() => setIsMasked(!isMasked)}
                title={isMasked ? t("auth.showPassword") : t("auth.hidePassword")}
              />
              <Button
                minimal
                small
                icon={copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                onClick={() => handleCopy(displayedKeys[0])}
                title={t("common.copy")}
              />
              <Button
                minimal
                small
                icon="cross"
                onClick={() => setDisplayedKeys(null)}
                title={t("common.close")}
              />
            </div>
          </div>

          <div className="p-3 bg-white dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 font-mono text-center text-lg sm:text-xl font-bold tracking-widest select-all text-gray-800 dark:text-gray-100">
            {isMasked
              ? "••••••-••••••-••••••-••••••-••••••"
              : displayedKeys[0]}
          </div>

          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <ShieldAlert size={14} className="shrink-0" />
            {t(
              "account.recoveryKey.securityTip",
              "Keep this recovery key secret. Anyone with access to this key can regain access to your account."
            )}
          </p>
        </Card>
      )}

      {/* Rotation Confirmation Alert */}
      <Alert
        isOpen={confirmRotateOpen}
        onConfirm={handleConfirmRotate}
        onCancel={() => setConfirmRotateOpen(false)}
        cancelButtonText={t("common.cancel", "Cancel")}
        confirmButtonText={t("account.recoveryKey.confirmRotateBtn", "Proceed to Rotate")}
        intent={Intent.DANGER}
        icon="warning-sign"
      >
        <p>
          {t(
            "account.recoveryKey.rotateConfirm",
            "Rotating your recovery key will immediately invalidate the current recovery key. You will need to verify your identity to complete this action."
          )}
        </p>
      </Alert>

      {/* Identity Verification Dialog */}
      <VerifyIdentityDialog
        isOpen={verifyDialogOpen}
        onClose={() => setVerifyDialogOpen(false)}
        user={user}
        title={
          verifyMode === "view"
            ? t("account.recoveryKey.viewVerifyTitle", "Verify Identity to View Key")
            : t("account.recoveryKey.rotateVerifyTitle", "Verify Identity to Rotate Key")
        }
        onVerify={handleVerifySubmit}
      />
    </div>
  );
};
