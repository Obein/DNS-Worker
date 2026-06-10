import React from "react";
import {
  Button,
  FormGroup,
  InputGroup,
  Callout,
  Intent,
  Divider
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { QRCodeCanvas } from "../../views/AccountView/components/QRCodeCanvas";

/**
 * Properties for the SignupTotpStep component.
 */
export interface SignupTotpStepProps {
  /** The data containing secret and URI for the TOTP setup. */
  totpSetupData: { secret: string; uri: string };
  /** The 6-digit TOTP token input value. */
  totpSetupToken: string;
  /** Callback to update the TOTP setup token. */
  setTotpSetupToken: (val: string) => void;
  /** Any active setup errors from the server. */
  totpSetupError: string;
  /** State indicating if verification request is loading. */
  totpSetupLoading: boolean;
  /** Callback to handle the verification form submission. */
  onSubmit: (e: React.FormEvent) => void;
  /** Callback to skip TOTP setup and move to the next screen. */
  onSkip: () => void;
}

/**
 * SignupTotpStep is the third step of the signup wizard.
 * It presents a QR code to bind the account with an authenticator app.
 *
 * @param props - Component props.
 * @returns React element representing TOTP setup step.
 */
export const SignupTotpStep: React.FC<SignupTotpStepProps> = ({
  totpSetupData,
  totpSetupToken,
  setTotpSetupToken,
  totpSetupError,
  totpSetupLoading,
  onSubmit,
  onSkip
}) => {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-3">
        <QRCodeCanvas uri={totpSetupData.uri} />
        <div className="text-center">
          <p className="text-xs text-gray-500 mb-1">
            {t("account.totp.orEnterManually", "Or enter the key manually:")}
          </p>
          <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">
            {totpSetupData.secret}
          </code>
        </div>
      </div>
      <Divider />
      {totpSetupError && (
        <Callout intent={Intent.DANGER}>{totpSetupError}</Callout>
      )}
      <form onSubmit={onSubmit} className="space-y-3">
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
          <InputGroup
            id="totp-signup-setup-token"
            placeholder="000000"
            value={totpSetupToken}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setTotpSetupToken(
                e.target.value.replace(/\D/g, "").slice(0, 6)
              )
            }
            maxLength={6}
            inputMode="numeric"
            className="font-mono tracking-widest text-center"
            required
          />
        </FormGroup>
        <div className="flex gap-2 pt-2">
          <Button
            fill
            text={t("auth.skip", "Skip")}
            onClick={onSkip}
          />
          <Button
            fill
            intent={Intent.SUCCESS}
            type="submit"
            loading={totpSetupLoading}
            text={t("account.totp.activate", "Activate")}
            disabled={totpSetupToken.length < 6}
          />
        </div>
      </form>
    </div>
  );
};
