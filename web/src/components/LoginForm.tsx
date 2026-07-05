import React from "react";
import { H3, Intent, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { LoginUsernameStep } from "./login/LoginUsernameStep";
import { LoginCredentialsStep } from "./login/LoginCredentialsStep";
import { useLoginForm } from "./login/useLoginForm";

/**
 * Authentication configuration settings fetched from server.
 */
interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
  optional_session_expiration_days?: number;
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
 * LoginForm component processes login step 1 (username verification) and step 2 (password & TOTP challenge).
 *
 * @param props - Component props containing authConfig, turnstileReady, and callbacks.
 * @returns React elements representing the login state machine and forms.
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
    requiresPassword,
    requiresTotp,
    useRecovery,
    setUseRecovery,
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
    resetToStep1
  } = useLoginForm({ authConfig, turnstileReady, onSuccess });

  return (
    <>
      <div className="flex flex-col items-center mb-8 relative">
        {loginStep === 2 && (
          <button
            onClick={resetToStep1}
            className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-transparent border-none cursor-pointer"
            title="Back to username"
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
          {loginStep === 2
            ? t("auth.authRequired", "Authentication Required")
            : t("auth.login")}
        </H3>
        <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
          {loginStep === 2 ? username : t("auth.welcomeBack")}
        </p>
      </div>

      {error && (
        <Callout
          intent={Intent.DANGER}
          className="mb-6 rounded-xl"
          title={t("auth.error")}
        >
          {error}
        </Callout>
      )}

      {/* Login Step 1 */}
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

      {/* Login Step 2 */}
      {loginStep === 2 && (
        <LoginCredentialsStep
          requiresPassword={requiresPassword}
          requiresTotp={requiresTotp}
          useRecovery={useRecovery}
          setUseRecovery={setUseRecovery}
          password={password}
          setPassword={setPassword}
          totpToken={totpToken}
          setTotpToken={setTotpToken}
          recoveryKey={recoveryKey}
          setRecoveryKey={setRecoveryKey}
          loading={loading}
          onClearError={() => setError("")}
          onSubmit={handleStep2Submit}
          keepLoggedIn={keepLoggedIn}
          setKeepLoggedIn={setKeepLoggedIn}
          optionalSessionExpirationDays={authConfig?.optional_session_expiration_days ?? 7}
        />
      )}

      {loginStep === 1 && (
        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
          <button
            onClick={onToggleMode}
            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline bg-transparent border-none cursor-pointer text-sm"
          >
            {t("auth.noAccount")}
          </button>
        </div>
      )}
    </>
  );
};
