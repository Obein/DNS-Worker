import React from "react";
import {
  H4,
  Tag,
  Intent,
  Button,
  Callout,
  Divider,
  FormGroup
} from "@blueprintjs/core";
import { Smartphone, Shield } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QRCodeCanvas } from "../QRCodeCanvas";
import { DigitInput } from "../../../../components/DigitInput";

/**
 * Properties for the TOTPSetupForm component.
 */
export interface TOTPSetupFormProps {
  /** The data fetched containing secret and URI for the TOTP setup. */
  setupData: { secret: string; uri: string } | null;
  /** The current value of the 6-digit TOTP verification token input. */
  setupToken: string;
  /** Callback to update the verification token. */
  setSetupToken: (val: string) => void;
  /** Any error message during TOTP setup or verification. */
  setupError: string;
  /** Flag showing if setup request or verification request is loading. */
  setupLoading: boolean;
  /** Callback to initiate the TOTP setup process on backend. */
  onStartSetup: () => void;
  /** Callback to confirm and activate TOTP with token. */
  onConfirmSetup: (e: React.FormEvent) => void;
  /** Callback to cancel setup and return to initial prompt. */
  onCancel: () => void;
}

/**
 * TOTPSetupForm component manages the initial prompt and QR/verify steps for configuring TOTP.
 *
 * @param props - Component props.
 * @returns React element representing setup form state.
 */
export const TOTPSetupForm: React.FC<TOTPSetupFormProps> = ({
  setupData,
  setupToken,
  setSetupToken,
  setupError,
  setupLoading,
  onStartSetup,
  onConfirmSetup,
  onCancel
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={20} className="text-blue-500" />
        <H4 style={{ margin: 0 }}>
          {t("account.totp.title", "Authenticator App (TOTP)")}
        </H4>
        <Tag minimal round intent={Intent.NONE}>
          {t("account.totp.disabled", "Disabled")}
        </Tag>
      </div>

      {!setupData ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t(
              "account.totp.setupDesc",
              "Add an extra layer of security. Use Google Authenticator, Authy, or any TOTP app."
            )}
          </p>
          {setupError && (
            <Callout intent={Intent.DANGER}>{setupError}</Callout>
          )}
          <Button
            intent={Intent.PRIMARY}
            icon={<Shield size={14} />}
            text={t(
              "account.totp.setupBtn",
              "Set Up Authenticator App (TOTP)"
            )}
            loading={setupLoading}
            onClick={onStartSetup}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium">
            {t(
              "account.totp.scanQR",
              "Scan this QR code with your authenticator app:"
            )}
          </p>
          <div className="flex flex-col items-center gap-3">
            <QRCodeCanvas uri={setupData.uri} />
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">
                {t("account.totp.orEnterManually", "Or enter the key manually:")}
              </p>
              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">
                {setupData.secret}
              </code>
            </div>
          </div>
          <Divider />
          {setupError && (
            <Callout intent={Intent.DANGER}>{setupError}</Callout>
          )}
          <form onSubmit={onConfirmSetup} className="space-y-3">
            <FormGroup
              label={t(
                "account.totp.enterCode",
                "Enter the 6-digit code to confirm:"
              )}
              helperText={t(
                "account.totp.enterCodeHint",
                "This verifies the key was scanned correctly."
              )}
            >
              <DigitInput
                length={6}
                value={setupToken}
                onChange={setSetupToken}
                disabled={setupLoading}
              />
            </FormGroup>
            <div className="flex gap-2">
              <Button text={t("account.cancel")} onClick={onCancel} />
              <Button
                intent={Intent.SUCCESS}
                type="submit"
                loading={setupLoading}
                text={t("account.totp.activate", "Activate")}
                disabled={setupToken.length < 6}
              />
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
