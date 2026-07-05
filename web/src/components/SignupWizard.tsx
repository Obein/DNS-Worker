import React from "react";
import { H3, Intent, Callout } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { SignupUsernameStep } from "./signup/SignupUsernameStep";
import { SignupPasswordStep } from "./signup/SignupPasswordStep";
import { SignupTotpStep } from "./signup/SignupTotpStep";
import { SignupRecoveryStep } from "./signup/SignupRecoveryStep";
import { useSignupWizard } from "./signup/useSignupWizard";

/**
 * Authentication configuration settings fetched from server.
 */
interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
}

/**
 * Properties for the SignupWizard component.
 */
interface SignupWizardProps {
  /** Authentication configuration containing site keys and toggles. */
  authConfig: AuthConfig | null;
  /** True if Turnstile library has loaded globally. */
  turnstileReady: boolean;
  /** Callback triggered on successful completion or skip of the registration flow. */
  onSuccess: () => void;
  /** Callback to toggle page mode back to login. */
  onToggleMode: () => void;
}

/**
 * SignupWizard component guides the user through registration:
 * - Step 1: Input & check username availability, solve Turnstile.
 * - Step 2: Input & validate password complexity, create account.
 * - Step 3: View QR code and confirm TOTP 2FA.
 * - Step 4: Show recovery keys.
 *
 * @param props - Component props containing authConfig, turnstileReady, and callbacks.
 * @returns React elements representing the registration steps and forms.
 */
export const SignupWizard: React.FC<SignupWizardProps> = ({
  authConfig,
  turnstileReady,
  onSuccess,
  onToggleMode
}) => {
  const { t } = useTranslation();

  const {
    signupStep,
    setSignupStep,
    username,
    setUsername,
    password,
    setPassword,
    totpSetupToken,
    setTotpSetupToken,
    totpSetupData,
    totpRecoveryKeys,
    loading,
    error,
    setError,
    usernameFocused,
    setUsernameFocused,
    passwordFocused,
    setPasswordFocused,
    copiedRecovery,
    totpSetupLoading,
    totpSetupError,
    turnstileStatus,
    turnstileRef,
    isTurnstileEnabled,
    checkUsernameDuplicate,
    handleSignupUsernameSubmit,
    handleSignupTotpConfirm,
    handleCopySignupRecoveryKeys,
    handleSignupSubmit
  } = useSignupWizard({ authConfig, turnstileReady, onSuccess });

  return (
    <>
      <div className="flex flex-col items-center mb-8 relative">
        {signupStep === "password" && (
          <button
            onClick={() => {
              setSignupStep("username");
              setError("");
            }}
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
          {signupStep === "username" || signupStep === "password"
            ? t("auth.signup")
            : signupStep === "totp"
            ? t("account.totp.title", "Two-Factor Authentication (2FA)")
            : t("account.totp.recoveryKeysTitle", "Save Recovery Keys")}
        </H3>
        <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
          {signupStep === "username" || signupStep === "password"
            ? signupStep === "password"
              ? username
              : t("auth.protectInternet")
            : signupStep === "totp"
            ? t("account.totp.setupDesc", "Add an extra layer of security.")
            : t("account.totp.recoveryKeysWarning", "Store keys safely.")}
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

      {/* Signup Step 1 (Username) */}
      {signupStep === "username" && (
        <SignupUsernameStep
          username={username}
          setUsername={setUsername}
          usernameFocused={usernameFocused}
          setUsernameFocused={setUsernameFocused}
          checkUsernameDuplicate={checkUsernameDuplicate}
          loading={loading}
          onSubmit={handleSignupUsernameSubmit}
          onClearError={() =>
            setError((prev) => (prev === t("auth.usernameExists") ? "" : prev))
          }
        />
      )}

      {/* Signup Step 2 (Password) */}
      {signupStep === "password" && (
        <SignupPasswordStep
          password={password}
          setPassword={setPassword}
          passwordFocused={passwordFocused}
          setPasswordFocused={setPasswordFocused}
          loading={loading}
          onSubmit={handleSignupSubmit}
          isTurnstileEnabled={isTurnstileEnabled}
          turnstileRef={turnstileRef}
          turnstileStatus={turnstileStatus}
        />
      )}

      {/* Signup Step 3: TOTP Setup */}
      {signupStep === "totp" && totpSetupData && (
        <SignupTotpStep
          totpSetupData={totpSetupData}
          totpSetupToken={totpSetupToken}
          setTotpSetupToken={setTotpSetupToken}
          totpSetupError={totpSetupError}
          totpSetupLoading={totpSetupLoading}
          onSubmit={handleSignupTotpConfirm}
          onSkip={onSuccess}
        />
      )}

      {/* Signup Step 4: TOTP Recovery Keys */}
      {signupStep === "recovery" && totpRecoveryKeys && (
        <SignupRecoveryStep
          totpRecoveryKeys={totpRecoveryKeys}
          copiedRecovery={copiedRecovery}
          onCopy={handleCopySignupRecoveryKeys}
          onSuccess={onSuccess}
        />
      )}

      {signupStep === "username" && (
        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
          <button
            onClick={onToggleMode}
            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline bg-transparent border-none cursor-pointer text-sm"
          >
            {t("auth.haveAccount")}
          </button>
        </div>
      )}
    </>
  );
};
