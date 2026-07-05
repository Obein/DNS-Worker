import React from "react";
import { Card, Elevation, H5, InputGroup, Button, Intent, OverlayToaster } from "@blueprintjs/core";
import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  Profile  } from "../types";

export interface SecurityAccessCardProps {
  profileId: string;
  profile: Profile | null;
  rotateProfileKey: () => void;
  rotatingKey: boolean;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export const SecurityAccessCard: React.FC<SecurityAccessCardProps> = ({
  profileId,
  profile,
  rotateProfileKey,
  rotatingKey,
  toasterRef,
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE} className="dark:bg-gray-900 dark:border-gray-800">
      <H5 className="flex items-center gap-2 mb-4 font-bold text-red-500">
        <Shield size={18} /> {t("settings.securityTitle", "Security & Access")}
      </H5>
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex-1 max-w-2xl">
          <div className="font-bold mb-2">{t("settings.rotateKeyTitle", "Access URL")}</div>
          <InputGroup
            readOnly
            value={`${window.location.origin}/${profile?.profile_key || profileId}`}
            className="mb-2 font-mono text-sm"
            rightElement={
              <Button
                icon="duplicate"
                minimal
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/${profile?.profile_key || profileId}`);
                  toasterRef?.current?.show({ message: t("settings.copied", "Copied to clipboard"), intent: Intent.SUCCESS });
                }}
              />
            }
          />
          <p className="text-xs opacity-60">
            {t(
              "settings.rotateKeyDesc",
              "Generate a new access URL for this profile. Any devices currently using the old URL will immediately lose their connection to DNS Worker and will need to be reconfigured with the new URL."
            )}
          </p>
        </div>
        <Button
          intent={Intent.DANGER}
          icon="refresh"
          text={t("settings.rotateKeyBtn", "Rotate URL")}
          onClick={rotateProfileKey}
          loading={rotatingKey}
        />
      </div>
    </Card>
  );
};
