import React from "react";
import { FormGroup, InputGroup, Button, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

/**
 * Properties for the LoginCredentialsStep component.
 */
export interface LoginCredentialsStepProps {
  /** Flag representing if password entry is required. */
  requiresPassword: boolean;
  /** Flag representing if TOTP challenge is required. */
  requiresTotp: boolean;
  /** Flag showing if recovery key is being used instead of authenticator app. */
  useRecovery: boolean;
  /** Callback to toggle between recovery key and TOTP token mode. */
  setUseRecovery: (useRecovery: boolean) => void;
  /** Current password input value. */
  password: string;
  /** Callback to update the password input value. */
  setPassword: (val: string) => void;
  /** Current 6-digit TOTP token input value. */
  totpToken: string;
  /** Callback to update the TOTP token value. */
  setTotpToken: (val: string) => void;
  /** Current recovery key input value. */
  recoveryKey: string;
  /** Callback to update the recovery key value. */
  setRecoveryKey: (val: string) => void;
  /** Indicates if login submission is loading. */
  loading: boolean;
  /** Callback to reset or clear errors when modes switch. */
  onClearError: () => void;
  /** Callback to handle the form submission. */
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * LoginCredentialsStep is the second step of the login flow.
 * It takes credentials (password and/or 2FA verification challenge).
 *
 * @param props - Component props.
 * @returns React element representing credential entry form.
 */
export const LoginCredentialsStep: React.FC<LoginCredentialsStepProps> = ({
  requiresPassword,
  requiresTotp,
  useRecovery,
  setUseRecovery,
  password,
  setPassword,
  totpToken,
  setTotpToken,
  recoveryKey,
  setRecoveryKey,
  loading,
  onClearError,
  onSubmit
}) => {
  const { t } = useTranslation();

  /**
   * Renders a clear button inside the password input group.
   *
   * @returns React element or undefined.
   */
  const renderPasswordClearButton = (): React.JSX.Element | undefined => {
    if (!password) return undefined;
    return (
      <Button
        minimal={true}
        icon="cross"
        onClick={() => setPassword("")}
      />
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {requiresPassword && (
        <FormGroup label={t("auth.password")} labelFor="password">
          <InputGroup
            id="password"
            leftIcon="lock"
            placeholder={t("auth.passwordPlaceholder")}
            type="password"
            size="large"
            className="rounded-xl"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPassword(e.target.value)
            }
            rightElement={renderPasswordClearButton()}
            autoFocus
            required
          />
        </FormGroup>
      )}

      {requiresTotp && (
        <>
          {useRecovery ? (
            <FormGroup
              label={t("account.totp.recoveryKeysTitle", "Recovery Key")}
            >
              <InputGroup
                id="recovery-key"
                leftIcon="key"
                placeholder="XXXXXXXXXX"
                size="large"
                className="rounded-xl font-mono tracking-widest"
                value={recoveryKey}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setRecoveryKey(e.target.value)
                }
                required
                autoFocus={!requiresPassword}
              />
            </FormGroup>
          ) : (
            <FormGroup
              label={
                requiresPassword
                  ? t("account.totp.title", "Two-Factor Verification (TOTP)")
                  : t("auth.totpVerification", "TOTP Verification")
              }
            >
              <InputGroup
                id="totp-code"
                leftIcon="shield"
                placeholder="000000"
                size="large"
                className="rounded-xl font-mono tracking-widest text-center"
                value={totpToken}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setTotpToken(
                    e.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                maxLength={6}
                inputMode="numeric"
                required
                autoFocus={!requiresPassword}
              />
            </FormGroup>
          )}

          <div className="text-right mt-1">
            <button
              type="button"
              onClick={() => {
                setUseRecovery(!useRecovery);
                onClearError();
              }}
              className="text-blue-600 dark:text-blue-400 text-xs hover:underline bg-transparent border-none cursor-pointer p-0"
            >
              {useRecovery
                ? t("auth.totpUseApp", "Use Authenticator App")
                : t("auth.totpUseRecovery", "Use Recovery Key")}
            </button>
          </div>
        </>
      )}

      <Button
        fill
        size="large"
        intent={Intent.PRIMARY}
        type="submit"
        loading={loading}
        className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
      >
        {t("auth.loginBtn")}
      </Button>
    </form>
  );
};
