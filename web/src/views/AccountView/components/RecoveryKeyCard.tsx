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
import { Key, Lock, RefreshCw, Eye, EyeOff, Copy, Check, ShieldAlert, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { VerifyIdentityDialog } from "./VerifyIdentityDialog";
import {
  rotateRecoveryKey,
  type VerifyIdentityPayload
} from "../../../services/account";
import { e2ee } from "../../../services/e2ee";

export interface RecoveryKeyCardProps {
  user: UserInfo;
  onRefresh: () => void;
}

export const RecoveryKeyCard: React.FC<RecoveryKeyCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  const [verifyDialogOpen, setVerifyDialogOpen] = useState(false);
  const [confirmRotateOpen, setConfirmRotateOpen] = useState(false);

  const [newKey, setNewKey] = useState<string | null>(null);
  const [isMasked, setIsMasked] = useState(false);
  const [copied, setCopied] = useState(false);

  const [cardMessage, setCardMessage] = useState<{ text: string; intent: Intent } | null>(null);

  const hasRecoveryKeys = !!(user.has_recovery_keys || user.recovery_keys_encrypted);

  const handleStartRotate = () => {
    setCardMessage(null);
    setConfirmRotateOpen(true);
  };

  const handleConfirmRotate = () => {
    setConfirmRotateOpen(false);
    setVerifyDialogOpen(true);
  };

  const handleVerifySubmit = async (payload: VerifyIdentityPayload) => {
    const res = await rotateRecoveryKey(payload);
    setNewKey(res.recovery_key);
    setIsMasked(false);

    let rewrapSuccess = false;
    // Re-wrap SK_user with newly rotated recovery key to maintain decryptability
    if (e2ee.isUnlocked()) {
      try {
        await e2ee.wrapCurrentKeyForRecovery(res.recovery_key);
        rewrapSuccess = true;
      } catch (wrapErr) {
        console.warn("[RecoveryKey] Failed to wrap E2EE key with new recovery key:", wrapErr);
      }
    } else {
      if (payload.recoveryKey) {
        try {
          await e2ee.unlockWithRecoveryKey(payload.recoveryKey);
          await e2ee.wrapCurrentKeyForRecovery(res.recovery_key);
          rewrapSuccess = true;
        } catch (err) {
          console.warn("[RecoveryKey] Failed to unlock and re-wrap with new recovery key:", err);
        }
      } else if (payload.passkeyAssertion) {
        try {
          await e2ee.unlockUser();
          await e2ee.wrapCurrentKeyForRecovery(res.recovery_key);
          rewrapSuccess = true;
        } catch (err) {
          console.warn("[RecoveryKey] Failed to unlock via Passkey and re-wrap:", err);
        }
      }
    }

    try {
      const e2eeStatus = await e2ee.getUserStatus();
      if (e2eeStatus.hasKeys && !rewrapSuccess) {
        setCardMessage({
          text: t(
            "account.recoveryKey.rotateSuccessE2eeWarning",
            "恢复密钥已成功轮换！注意：由于端到端加密此前处于锁定状态且未能解密，旧 E2EE 密文仍需使用轮换前的旧恢复密钥解锁，或可在下方端到端加密卡片中点击「重置密钥对」。"
          ),
          intent: Intent.WARNING
        });
        onRefresh();
        return;
      }
    } catch {
      // ignore
    }

    setCardMessage({
      text: t(
        "account.recoveryKey.rotateSuccess",
        "恢复密钥已成功轮换！请立即妥善离线保存新密钥，旧密钥已失效。"
      ),
      intent: Intent.SUCCESS
    });
    onRefresh();
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
            {t("account.recoveryKey.title", "紧急恢复密钥")}
          </H4>
          <Tag intent={hasRecoveryKeys ? Intent.SUCCESS : Intent.NONE} minimal round>
            {hasRecoveryKeys
              ? t("account.recoveryKey.configured", "已配置")
              : t("account.recoveryKey.notConfigured", "未配置")}
          </Tag>
          <Tooltip
            content={t(
              "account.recoveryKey.oneWayTooltip",
              "采用 SHA-256 单向密码学散列保护，服务端不存储明文且不可解密，仅支持身份轮换验证。"
            )}
            position={Position.TOP}
          >
            <Tag
              intent={Intent.PRIMARY}
              minimal
              round
              icon={<ShieldCheck size={12} style={{ display: "inline-flex", alignItems: "center", marginRight: "4px" }} />}
            >
              {t("account.recoveryKey.oneWayHash", "单向不可逆散列")}
            </Tag>
          </Tooltip>
        </div>

        <div className="flex items-center gap-2">
          <Button
            small
            intent={Intent.WARNING}
            icon={<RefreshCw size={14} />}
            text={t("account.recoveryKey.rotateBtn", "轮换恢复密钥")}
            onClick={handleStartRotate}
          />
        </div>
      </div>

      <p className="text-sm text-gray-600 dark:text-gray-400">
        {t(
          "account.recoveryKey.descOneWay",
          "紧急恢复密钥是在您丢失所有通行密钥 (Passkey) 或身份验证器时，恢复账号访问及端到端解密数据的唯一凭据。为确保零知识安全，恢复密钥采用单向不可逆散列存储，无法在网页端查看明文，仅支持通过原恢复密钥或现有 Passkey 进行轮换。密钥一旦被使用将立即自动轮换。"
        )}
      </p>

      {cardMessage && (
        <Callout intent={cardMessage.intent} className="my-2">
          {cardMessage.text}
        </Callout>
      )}

      {/* Displayed Newly Rotated Key Card */}
      {newKey && (
        <Card elevation={Elevation.ZERO} className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert size={14} />
              {t("account.recoveryKey.newKeyGenerated", "已生成全新 30 位恢复密钥（请立即保存）")}
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              <Button
                minimal
                small
                icon={isMasked ? <Eye size={14} /> : <EyeOff size={14} />}
                onClick={() => setIsMasked(!isMasked)}
                title={isMasked ? t("auth.showPassword", "显示") : t("auth.hidePassword", "隐藏")}
              />
              <Button
                minimal
                small
                icon={copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                onClick={() => handleCopy(newKey)}
                title={t("common.copy", "复制")}
                text={copied ? t("common.copied", "已复制") : t("common.copy", "复制")}
              />
              <Button
                minimal
                small
                icon="cross"
                onClick={() => setNewKey(null)}
                title={t("common.close", "关闭")}
              />
            </div>
          </div>

          <div className="p-3 bg-white dark:bg-gray-900 rounded border border-amber-200 dark:border-amber-800/80 font-mono text-center text-lg sm:text-xl font-bold tracking-widest select-all text-gray-900 dark:text-gray-100">
            {isMasked
              ? "••••••-••••••-••••••-••••••-••••••"
              : newKey}
          </div>

          <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
            <Lock size={14} className="shrink-0" />
            {t(
              "account.recoveryKey.oneWayWarning",
              "注意：此密钥仅在此显示一次，关闭后将无法再次查看！服务端仅保存不可逆散列，请务必将其妥善复制并离线安全保存。"
            )}
          </p>
        </Card>
      )}

      {/* Rotation Confirmation Alert */}
      <Alert
        isOpen={confirmRotateOpen}
        onConfirm={handleConfirmRotate}
        onCancel={() => setConfirmRotateOpen(false)}
        cancelButtonText={t("common.cancel", "取消")}
        confirmButtonText={t("account.recoveryKey.confirmRotateBtn", "确认进入轮换验证")}
        intent={Intent.DANGER}
        icon="warning-sign"
      >
        <p>
          {t(
            "account.recoveryKey.rotateConfirm",
            "轮换恢复密钥将立即使原恢复密钥失效，并重新派生信封加密密钥。仅允许通过现有通行密钥 (Passkey) 或原恢复密钥完成轮换验证。是否继续？"
          )}
        </p>
      </Alert>

      {/* Identity Verification Dialog (Passkey or original Recovery Key only) */}
      <VerifyIdentityDialog
        isOpen={verifyDialogOpen}
        onClose={() => setVerifyDialogOpen(false)}
        user={user}
        allowedMethods={["passkey", "recovery_key"]}
        title={t("account.recoveryKey.rotateVerifyTitle", "验证身份以轮换恢复密钥")}
        onVerify={handleVerifySubmit}
      />
    </div>
  );
};
