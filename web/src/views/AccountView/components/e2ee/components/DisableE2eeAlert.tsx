import React from "react";
import { Alert, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface DisableE2eeAlertProps {
  isOpen: boolean;
  processing: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export const DisableE2eeAlert: React.FC<DisableE2eeAlertProps> = ({
  isOpen,
  processing,
  onConfirm,
  onCancel
}) => {
  const { t } = useTranslation();

  return (
    <Alert
      isOpen={isOpen}
      confirmButtonText={t("common.confirmDisable")}
      cancelButtonText={t("common.cancel")}
      intent={Intent.DANGER}
      icon="unlock"
      onConfirm={onConfirm}
      onCancel={onCancel}
      loading={processing}
    >
      <p>{t("account.e2ee.disableConfirm")}</p>
    </Alert>
  );
};
