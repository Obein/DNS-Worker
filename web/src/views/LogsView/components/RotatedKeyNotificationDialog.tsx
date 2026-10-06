import React from "react";
import { Dialog, Classes, Callout, Button, Intent } from "@blueprintjs/core";
import { Copy, Check, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface RotatedKeyNotificationDialogProps {
  rotatedKey: string | null;
  onClose: () => void;
  copiedKey: boolean;
  onCopyKey: (key: string) => void;
}

/**
 * Modal dialog that forces user awareness of a newly auto-rotated recovery key,
 * ensuring they copy the new key before continuing.
 */
export const RotatedKeyNotificationDialog: React.FC<RotatedKeyNotificationDialogProps> = ({
  rotatedKey,
  onClose,
  copiedKey,
  onCopyKey
}) => {
  const { t } = useTranslation();

  return (
    <Dialog
      isOpen={!!rotatedKey}
      onClose={onClose}
      title={t("account.recoveryKey.autoRotatedTitle", "恢复密钥已自动轮换")}
      icon="warning-sign"
      isCloseButtonShown={false}
      canOutsideClickClose={false}
      className="dark:bg-gray-900"
    >
      <div className={Classes.DIALOG_BODY}>
        <Callout
          intent={Intent.WARNING}
          icon={<ShieldAlert size={16} />}
          className="mb-4 text-xs"
        >
          {t(
            "account.recoveryKey.autoRotatedNotice",
            "根据恢复密钥单次使用规则，您的原恢复密钥已失效，系统已为您生成全新 30 位紧急恢复密钥。请务必立即复制并妥善离线保存，关闭后将无法再次查看！"
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
                icon={
                  copiedKey ? (
                    <Check size={14} className="text-green-400" />
                  ) : (
                    <Copy size={14} />
                  )
                }
                text={
                  copiedKey
                    ? t("common.copied", "已复制")
                    : t("common.copyKey", "复制新恢复密钥")
                }
                onClick={() => onCopyKey(rotatedKey)}
              />
            </div>
          </div>
        )}
      </div>
      <div className={Classes.DIALOG_FOOTER}>
        <div className={Classes.DIALOG_FOOTER_ACTIONS}>
          <Button
            intent={Intent.SUCCESS}
            onClick={onClose}
            text={t("account.recoveryKey.savedAndClose", "我已妥善保存并继续")}
          />
        </div>
      </div>
    </Dialog>
  );
};
