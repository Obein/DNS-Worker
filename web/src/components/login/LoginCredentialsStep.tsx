import React from "react";
import { FormGroup, InputGroup, Button, Intent, Checkbox } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Fingerprint } from "lucide-react";
import { DigitInput } from "../DigitInput";

/**
 * Properties for the LoginCredentialsStep component.
 */
export interface LoginCredentialsStepProps {
  /** Flag representing if password entry is required. */
  requiresPassword: boolean;
  /** Flag representing if TOTP challenge is required. */
  requiresTotp: boolean;
  /** Flag representing if user has registered passkeys. */
  hasPasskey?: boolean;
  /** Indicates if passkey authentication is actively in progress. */
  passkeyLoading?: boolean;
  /** Callback to trigger passkey authentication. */
  onPasskeyLogin?: () => void;
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
  /** Whether the user wants to stay logged in. */
  keepLoggedIn: boolean;
  /** Callback to toggle stay logged in. */
  setKeepLoggedIn: (val: boolean) => void;
  /** Optional session expiration duration in days. */
  optionalSessionExpirationDays: number;
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
  hasPasskey = false,
  passkeyLoading = false,
  onPasskeyLogin,
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
  onSubmit,
  keepLoggedIn,
  setKeepLoggedIn,
  optionalSessionExpirationDays
}) => {
  const [showPassword, setShowPassword] = React.useState(false);
  const { t } = useTranslation();

  /**
   * Renders the right elements (clear and/or show/hide password buttons) inside the password input group.
   *
   * @returns React element.
   */
  const renderPasswordRightElement = (): React.JSX.Element => {
    return (
      <div className="flex items-center">
        {password && (
          <Button
            minimal={true}
            icon="cross"
            onClick={() => setPassword("")}
          />
        )}
        <Button
          minimal={true}
          icon={showPassword ? "eye-open" : "eye-off"}
          onClick={() => setShowPassword(!showPassword)}
          title={showPassword ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
        />
      </div>
    );
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (hasPasskey && !totpToken && !recoveryKey && onPasskeyLogin) {
      onPasskeyLogin();
      return;
    }
    onSubmit(e);
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-4">
      {requiresPassword && (
        <FormGroup label={t("auth.password")} labelFor="password">
          <InputGroup
            id="password"
            leftIcon="lock"
            placeholder={t("auth.passwordPlaceholder")}
            type={showPassword ? "text" : "password"}
            size="large"
            className="rounded-xl"
            value={password}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPassword(e.target.value)
            }
            rightElement={renderPasswordRightElement()}
            autoFocus
            required
          />
        </FormGroup>
      )}

      {hasPasskey && (
        <div className="space-y-3 pt-1">
          <Button
            fill
            size="large"
            intent={Intent.PRIMARY}
            type="button"
            loading={passkeyLoading}
            disabled={loading}
            onClick={onPasskeyLogin}
            className="font-semibold py-5 rounded-xl shadow-md flex items-center justify-center space-x-2"
          >
            <Fingerprint size={20} className="mr-1.5" />
            <span>{t("auth.verifyWithPasskey", "使用通行密钥验证")}</span>
          </Button>

          {requiresTotp && (
            <div className="relative flex py-2 items-center">
              <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
              <span className="flex-shrink mx-3 text-gray-400 text-xs">
                {t("auth.orUseTotp", "或使用验证码")}
              </span>
              <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
            </div>
          )}
        </div>
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
              <DigitInput
                length={6}
                value={totpToken}
                onChange={setTotpToken}
                disabled={loading}
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

      <Checkbox
        checked={keepLoggedIn}
        onChange={(e) => setKeepLoggedIn(e.currentTarget.checked)}
        label={t("auth.keepLoggedIn", "Keep me logged in for {{days}} days", { days: optionalSessionExpirationDays })}
        className="mt-4 text-left"
      />

      {(!hasPasskey || requiresTotp) && (
        <Button
          fill
          size="large"
          intent={hasPasskey ? Intent.NONE : Intent.PRIMARY}
          type="submit"
          loading={loading}
          disabled={passkeyLoading}
          className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
        >
          {t("auth.loginBtn")}
        </Button>
      )}
    </form>
  );
};
