import React from "react";
import { Callout, Button, Intent } from "@blueprintjs/core";
import { KeyRound, Key } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface InitKeyCalloutProps {
  hasPasskey: boolean;
  processing: boolean;
  onGenerateKeyWithPasskey: () => Promise<void>;
  onOpenInitRecoveryDialog: () => void;
}

export const InitKeyCallout: React.FC<InitKeyCalloutProps> = ({
  hasPasskey,
  processing,
  onGenerateKeyWithPasskey,
  onOpenInitRecoveryDialog
}) => {
  const { t } = useTranslation();

  return (
    <Callout intent={Intent.PRIMARY} icon="shield" className="my-3 text-xs">
      <div className="space-y-3">
        <div>
          <h5 className="font-semibold text-sm mb-1 text-blue-900 dark:text-blue-100">
            {t("account.e2ee.noKeypairTitle")}
          </h5>
          <p className="text-xs text-blue-800 dark:text-blue-200 m-0">
            {t("account.e2ee.noKeypairDesc")}
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
              onClick={onGenerateKeyWithPasskey}
            />
          ) : (
            <Button
              intent={Intent.PRIMARY}
              small
              icon={<Key size={14} />}
              text={t("account.e2ee.addPasskeyBtn")}
              onClick={() => {
                document
                  .getElementById("passkeys-section")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            />
          )}

          <Button
            intent={Intent.NONE}
            small
            icon={<Key size={14} />}
            text={t("account.e2ee.initRecoveryBtn")}
            onClick={onOpenInitRecoveryDialog}
          />
        </div>
      </div>
    </Callout>
  );
};
