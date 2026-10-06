import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { validateUsername, formatApiErrorMessage } from "../../utils/auth";
import { prelogin } from "../../services";
import { useTurnstile } from "./hooks/useTurnstile";
import { useLoginAuth } from "./hooks/useLoginAuth";
import { useMfaStep } from "./hooks/useMfaStep";

export interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
  optional_session_expiration_days?: number;
}

export interface UseLoginFormProps {
  authConfig: AuthConfig | null;
  turnstileReady: boolean;
  onSuccess: () => void;
}

/**
 * Custom coordinator hook to manage the login state machine across:
 * Step 1: Username & Turnstile challenge
 * Step 2: Password challenge
 * Step 3: MFA (Passkey / TOTP / Recovery Key)
 */
export const useLoginForm = ({
  authConfig,
  turnstileReady,
  onSuccess
}: UseLoginFormProps) => {
  const { t } = useTranslation();

  // Steps: 1 = Username, 2 = Password, 3 = MFA
  const [loginStep, setLoginStep] = useState<1 | 2 | 3>(1);

  // Form input states
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [keepLoggedIn, setKeepLoggedIn] = useState<boolean>(false);

  // Cryptographic challenge & account capabilities returned by prelogin
  const [passwordVersion, setPasswordVersion] = useState<number>(1);
  const [nonce, setNonce] = useState<string | undefined>(undefined);
  const [serverSalt, setServerSalt] = useState<string | null | undefined>(undefined);
  const [requiresPassword, setRequiresPassword] = useState<boolean>(true);
  const [requiresTotp, setRequiresTotp] = useState<boolean>(false);
  const [hasPasskey, setHasPasskey] = useState<boolean>(false);
  const [passkeyOptions, setPasskeyOptions] = useState<unknown>(null);

  // Core login execution & challenge solver hook
  const {
    loading: authLoading,
    error,
    setError,
    rotatedRecoveryKey,
    setRotatedRecoveryKey,
    executeLogin
  } = useLoginAuth({
    username,
    password,
    passwordVersion,
    nonce,
    serverSalt,
    keepLoggedIn,
    onSuccess
  });

  const [step1Loading, setStep1Loading] = useState<boolean>(false);
  const loading = authLoading || step1Loading;

  const isTurnstileEnabled = authConfig?.turnstile_enabled_login;

  // Turnstile hook
  const {
    turnstileToken,
    turnstileStatus,
    turnstileRef,
    resetTurnstile
  } = useTurnstile({
    siteKey: authConfig?.turnstile_site_key,
    enabled: isTurnstileEnabled,
    turnstileReady,
    isActive: loginStep === 1,
    onError: setError,
    onClearError: () => setError("")
  });

  // Step 3 MFA hook
  const {
    mfaMethod,
    setMfaMethod,
    totpToken,
    setTotpToken,
    recoveryKey,
    setRecoveryKey,
    passkeyLoading,
    handlePasskeyLogin,
    handleStep3Submit,
    resetMfaFields
  } = useMfaStep({
    hasPasswordEntered: !!password,
    passkeyOptions,
    executeLogin,
    onError: setError
  });

  /**
   * Submits Step 1 (Username + Turnstile).
   */
  const handleStep1Submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!validateUsername(username)) {
      setError(t("auth.formatTipUsername"));
      return;
    }
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !turnstileToken) {
      setError(t("auth.turnstileRequired"));
      return;
    }

    setStep1Loading(true);
    setError("");

    try {
      const data = await prelogin({ username, turnstileToken });
      setRequiresPassword(data.requires_password);
      setRequiresTotp(data.requires_totp);
      setHasPasskey(!!data.has_passkey);
      setPasskeyOptions(data.passkey_options || null);
      setPasswordVersion(data.password_version ?? 1);
      setNonce(data.nonce);
      setServerSalt(data.serverSalt);

      const userHasPasskey = !!data.has_passkey;
      setMfaMethod(userHasPasskey ? "passkey" : "totp");

      // If passwordless login is enabled, advance directly to MFA step
      if (!data.requires_password) {
        setLoginStep(3);
      } else {
        setLoginStep(2);
      }
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
      resetTurnstile();
    } finally {
      setStep1Loading(false);
    }
  };

  /**
   * Submits Step 2 (Password input).
   * If user has MFA configured, advances to Step 3. Otherwise, completes login.
   */
  const handleStep2Submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!password) {
      setError(t("auth.passwordRequiredFirst", "Please enter your password first"));
      return;
    }

    const hasMfa = hasPasskey || requiresTotp;
    if (hasMfa) {
      setError("");
      setLoginStep(3);
      setMfaMethod(hasPasskey ? "passkey" : "totp");
    } else {
      await executeLogin({ useEnteredPassword: true });
    }
  };

  /**
   * Switches directly from Password Step to MFA Step via "Other options".
   */
  const handleSwitchToMfa = (): void => {
    setPassword("");
    setError("");
    setLoginStep(3);
    setMfaMethod(hasPasskey ? "passkey" : "totp");
  };

  const resetToStep1 = (): void => {
    setLoginStep(1);
    setPassword("");
    setError("");
    setNonce(undefined);
    setServerSalt(undefined);
    setHasPasskey(false);
    setPasskeyOptions(null);
    resetMfaFields();
    resetTurnstile();
  };

  /**
   * Navigates back one step.
   */
  const handleBack = (): void => {
    setError("");
    if (loginStep === 2) {
      resetToStep1();
    } else if (loginStep === 3) {
      if (requiresPassword) {
        setLoginStep(2);
      } else {
        resetToStep1();
      }
    }
  };

  const handleAcknowledgeRotatedKey = (): void => {
    setRotatedRecoveryKey(null);
    onSuccess();
  };

  return {
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
    handleBack,
    resetToStep1,
    rotatedRecoveryKey,
    handleAcknowledgeRotatedKey
  };
};
