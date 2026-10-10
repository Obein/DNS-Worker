import React from "react";
import { Alert, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface ResetKeypairAlertProps {
  isOpen: boolean;
  processing: boolean;
  hasPasskey: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

/**
 * Confirmation dialog for purging inaccessible or desynchronized E2EE keys
 * and re-initializing a fresh post-quantum keypair.
 */
export const ResetKeypairAlert: React.FC<ResetKeypairAlertProps> = ({
  isOpen,
  processing,
  hasPasskey,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation();

  return (
    <Alert
      isOpen={isOpen}
      confirmButtonText={t("account.e2ee.confirmResetBtn", "确认重置并重新生成")}
      cancelButtonText={t("common.cancel", "取消")}
      intent={Intent.DANGER}
      icon="reset"
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={processing}
    >
      <div className="space-y-2 text-xs">
        <p className="font-semibold text-gray-900 dark:text-gray-100">
          {t("account.e2ee.resetKeypairTitle", "重置端到端加密密钥对")}
        </p>
        <p>
          {t(
            "account.e2ee.resetKeypairDesc",
            "如果您的恢复密钥不匹配或无法解密，且未关联通行密钥，重置密钥对将从服务端清除旧密钥，并为您重新生成全新的后量子 (P256-MLKEM768) 密钥对。"
          )}
        </p>
        <p className="text-gray-500 dark:text-gray-400">
          {hasPasskey
            ? t(
                "account.e2ee.resetKeypairPasskeyNotice",
                "确认后将立即调用您当前已配置的通行密钥 (Passkey) 完成新密钥对的加密与授权。"
              )
            : t(
                "account.e2ee.resetKeypairRecoveryNotice",
                "确认后将引导您输入当前恢复密钥以完成新密钥对的生成与加密。"
              )}
        </p>
      </div>
    </Alert>
  );
};
