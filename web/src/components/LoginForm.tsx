import React from "react";
import { H3, Intent, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { LoginUsernameStep } from "./login/LoginUsernameStep";
import { LoginPasswordStep } from "./login/LoginPasswordStep";
import { LoginMfaStep } from "./login/LoginMfaStep";
import { useLoginForm } from "./login/useLoginForm";

/**
 * Authentication configuration settings fetched from server.
 */
interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
  optional_session_expiration_days?: number;
  has_users?: boolean;
}

/**
 * Properties for the LoginForm component.
 */
interface LoginFormProps {
  /** Authentication configuration containing site keys and toggles. */
  authConfig: AuthConfig | null;
  /** True if Turnstile library has loaded globally. */
  turnstileReady: boolean;
  /** Callback triggered on successful authentication. */
  onSuccess: () => void;
  /** Callback to toggle page mode to registration (signup). */
  onToggleMode: () => void;
}

/**
 * LoginForm processes login in distinct, decoupled steps:
 * 1. Username input & Turnstile verification
 * 2. Password input (if required, with "Other options" switch to MFA)
 * 3. MFA verification (Passkey prioritized, with "Other options" switch to TOTP / Recovery)
 */
export const LoginForm: React.FC<LoginFormProps> = ({
  authConfig,
  turnstileReady,
  onSuccess,
  onToggleMode
}) => {
  const { t } = useTranslation();

  const {
    loginStep,
    username,
    setUsername,
    password,
    setPassword,
    totpToken,
    setTotpToken,
    recoveryKey,
    setRecoveryKey,
    requiresTotp,
    hasPasskey,
    mfaMethod,
    setMfaMethod,
    passkeyLoading,
    loading,
    error,
    setError,
    turnstileStatus,
    turnstileRef,
    isTurnstileEnabled,
    keepLoggedIn,
    setKeepLoggedIn,
    handleStep1Submit,
    handleStep2Submit,
    handleStep3Submit,
    handleSwitchToMfa,
    handlePasskeyLogin,
    handleBack
  } = useLoginForm({ authConfig, turnstileReady, onSuccess });

  const getStepTitle = (): string => {
    switch (loginStep) {
      case 1:
        return t("auth.login");
      case 2:
        return t("auth.password");
      case 3:
        return t("auth.mfaVerification", "多因素认证");
    }
  };

  return (
    <>
      <div className="flex flex-col items-center mb-8 relative">
        {loginStep !== 1 && (
          <button
            type="button"
            onClick={handleBack}
            className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-transparent border-none cursor-pointer p-1 rounded-lg transition-colors"
            title={t("common.back", "返回")}
          >
            <ArrowLeft size={24} />
          </button>
        )}
        <img
          src={LogoIcon}
          alt="DNS Worker Logo"
          className="w-20 h-20 object-contain"
        />
        <H3 className="font-bold tracking-tight text-2xl mt-4">
          {getStepTitle()}
        </H3>
        <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
          {loginStep === 1 ? t("auth.welcomeBack") : username}
        </p>
      </div>

      {authConfig?.has_users === false && (
        <Callout
          intent={Intent.PRIMARY}
          icon="info-sign"
          className="mb-6 rounded-xl"
        >
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <span className="text-sm font-medium">
              {t("auth.noUsersRegistered", "系统尚无账号，请注册成为管理员。")}
            </span>
            <button
              type="button"
              onClick={onToggleMode}
              className="text-xs bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1.5 px-3 rounded-lg border-none cursor-pointer whitespace-nowrap transition-colors"
            >
              {t("auth.goToRegisterAdmin", "注册管理员")}
            </button>
          </div>
        </Callout>
      )}

      {error && (
        <Callout
          intent={Intent.DANGER}
          className="mb-6 rounded-xl"
          title={t("auth.error")}
        >
          {error}
        </Callout>
      )}

      {/* Step 1: Username & Turnstile */}
      {loginStep === 1 && (
        <LoginUsernameStep
          username={username}
          setUsername={setUsername}
          isTurnstileEnabled={isTurnstileEnabled}
          turnstileRef={turnstileRef}
          loading={loading}
          turnstileStatus={turnstileStatus}
          onSubmit={handleStep1Submit}
        />
      )}

      {/* Step 2: Password (if required) */}
      {loginStep === 2 && (
        <LoginPasswordStep
          password={password}
          setPassword={setPassword}
          hasMfa={hasPasskey || requiresTotp}
          onSwitchToMfa={handleSwitchToMfa}
          loading={loading}
          onSubmit={handleStep2Submit}
          keepLoggedIn={keepLoggedIn}
          setKeepLoggedIn={setKeepLoggedIn}
          optionalSessionExpirationDays={
            authConfig?.optional_session_expiration_days ?? 7
          }
        />
      )}

      {/* Step 3: MFA (Passkey prioritized, or TOTP / Recovery Key) */}
      {loginStep === 3 && (
        <LoginMfaStep
          hasPasskey={hasPasskey}
          requiresTotp={requiresTotp}
          mfaMethod={mfaMethod}
          setMfaMethod={setMfaMethod}
          passkeyLoading={passkeyLoading}
          onPasskeyLogin={handlePasskeyLogin}
          totpToken={totpToken}
          setTotpToken={setTotpToken}
          recoveryKey={recoveryKey}
          setRecoveryKey={setRecoveryKey}
          loading={loading}
          onClearError={() => setError("")}
          onSubmit={handleStep3Submit}
          keepLoggedIn={keepLoggedIn}
          setKeepLoggedIn={setKeepLoggedIn}
          optionalSessionExpirationDays={
            authConfig?.optional_session_expiration_days ?? 7
          }
        />
      )}

      {loginStep === 1 && (
        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 flex justify-center items-center text-sm">
          <button
            onClick={onToggleMode}
            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline bg-transparent border-none cursor-pointer"
          >
            {t("auth.noAccount")}
          </button>
        </div>
      )}
    </>
  );
};
