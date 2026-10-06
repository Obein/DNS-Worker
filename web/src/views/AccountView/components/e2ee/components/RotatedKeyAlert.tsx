import React from "react";
import {
  Dialog,
  Classes,
  Callout,
  Button,
  Intent
} from "@blueprintjs/core";
import { Check, Copy, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface RotatedKeyAlertProps {
  rotatedKey: string | null;
  onClose: () => void;
  copiedKey: boolean;
  onCopyKey: (key: string) => void;
}

export const RotatedKeyAlert: React.FC<RotatedKeyAlertProps> = ({
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
      title={t("account.recoveryKey.autoRotatedTitle")}
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
          {t("account.recoveryKey.autoRotatedNotice")}
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
                text={copiedKey ? t("common.copied") : t("common.copyKey")}
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
            text={t("account.recoveryKey.savedAndClose")}
          />
        </div>
      </div>
    </Dialog>
  );
};
