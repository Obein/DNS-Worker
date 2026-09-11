import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  validateUsername,
  isPasswordLeaked,
  hashTotpToken,
  hashPasswordClient,
  deriveStoredHashClient,
  hmacSha256,
  formatApiErrorMessage
} from "../../utils/auth";
import { setAccessToken } from "../../utils/token";
import { prelogin, login, ApiError, migratePassword } from "../../services";
import { startPasskeyAuthentication } from "../../utils/webauthn";

interface AuthConfig {
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
 * Custom hook to manage the login state machine across:
 * Step 1: Username
 * Step 2: Password (if required; with "Other options" switch to MFA)
 * Step 3: MFA (Passkey prioritized; with "Other options" switch to TOTP / Recovery)
 */
export const useLoginForm = ({
  authConfig,
  turnstileReady,
  onSuccess
}: UseLoginFormProps) => {
  // Steps: 1 = Username, 2 = Password, 3 = MFA
  const [loginStep, setLoginStep] = useState<1 | 2 | 3>(1);

  // Input states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [keepLoggedIn, setKeepLoggedIn] = useState(false);
  const [passwordVersion, setPasswordVersion] = useState<number>(1);
  const [nonce, setNonce] = useState<string | undefined>(undefined);
  const [serverSalt, setServerSalt] = useState<string | null | undefined>(undefined);

  // Server response step requirements
  const [requiresPassword, setRequiresPassword] = useState(true);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [hasPasskey, setHasPasskey] = useState(false);
  const [passkeyOptions, setPasskeyOptions] = useState<any>(null);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  // Active MFA method in Step 3
  const [mfaMethod, setMfaMethod] = useState<"passkey" | "totp" | "recovery">("passkey");

  // Status indicators
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Turnstile state
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<
    "idle" | "verifying" | "success" | "error"
  >("idle");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const { t } = useTranslation();
  const isTurnstileEnabled = authConfig?.turnstile_enabled_login;

  useEffect(() => {
    // Only render turnstile in Step 1
    if (
      loginStep === 1 &&
      isTurnstileEnabled &&
      authConfig?.turnstile_site_key &&
      (turnstileReady || window.turnstile) &&
      turnstileRef.current
    ) {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        setTurnstileStatus("verifying");
        turnstileRef.current.innerHTML = "";
        const widgetId = window.turnstile.render(turnstileRef.current, {
          sitekey: authConfig.turnstile_site_key,
          callback: (token: string) => {
            setTurnstileToken(token);
            setTurnstileStatus("success");
            setError("");
          },
          "expired-callback": () => {
            setTurnstileToken(null);
            setTurnstileStatus("idle");
          },
          "error-callback": (err: unknown) => {
            console.error("Turnstile error:", err);
            setTurnstileStatus("error");
            setError(
              t(
                "auth.turnstileError",
                "Verification service failed to load. Please reload and try again."
              )
            );
            setTurnstileToken(null);
          }
        });
        widgetIdRef.current = widgetId;
      } catch (e) {
        console.error("Turnstile render error:", e);
        setTurnstileStatus("error");
      }
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [isTurnstileEnabled, authConfig, loginStep, turnstileReady, t]);

  /**
   * Submits Step 1 (Username + Turnstile).
   */
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUsername(username)) {
      setError(t("auth.formatTipUsername"));
      return;
    }
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !turnstileToken) {
      setError(t("auth.turnstileRequired"));
      return;
    }

    setLoading(true);
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
      const initialMfaMethod: "passkey" | "totp" = userHasPasskey ? "passkey" : "totp";
      setMfaMethod(initialMfaMethod);

      // If passwordless login is enabled, skip password step directly to MFA step
      if (!data.requires_password) {
        setLoginStep(3);
      } else {
        setLoginStep(2);
      }
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
      if (window.turnstile) window.turnstile.reset();
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Helper to perform the final login call with provided credentials.
   */
  const executeLogin = async (credentials: {
    useEnteredPassword?: boolean;
    passkeyAssertion?: any;
    totpTokenHash?: string;
    totpSalt?: string;
    recoveryKey?: string;
  }) => {
    setLoading(true);
    setError("");

    try {
      const body: {
        password?: string;
        recoveryKey?: string;
        totpTokenHash?: string;
        totpSalt?: string;
        passkeyAssertion?: any;
        keepLoggedIn?: boolean;
      } = {
        keepLoggedIn,
        passkeyAssertion: credentials.passkeyAssertion,
        totpTokenHash: credentials.totpTokenHash,
        totpSalt: credentials.totpSalt,
        recoveryKey: credentials.recoveryKey
      };

      // If user entered password in Step 2, compute challenge response
      if (credentials.useEnteredPassword && password) {
        if (passwordVersion === 2) {
          if (!nonce || !serverSalt) {
            throw new Error(t("auth.sessionExpired", "Session expired, please start over"));
          }
          const clientHash = await hashPasswordClient(password, username);
          const storedHash = await deriveStoredHashClient(clientHash, serverSalt);
          body.password = await hmacSha256(storedHash, nonce);
        } else {
          body.password = password;
        }
      }

      const data = await login(body);
      if (data.accessToken) {
        setAccessToken(data.accessToken);
      }
      if (data.needsMigration && password) {
        const clientHash = await hashPasswordClient(password, username);
        await migratePassword(clientHash);
      }
      onSuccess();
    } catch (err: any) {
      if (err instanceof ApiError) {
        const fakeRes = { status: err.status } as Response;
        if (isPasswordLeaked(fakeRes, err.bodyText)) {
          setError(t("auth.passwordLeaked"));
        } else {
          setError(formatApiErrorMessage(err, t));
        }
      } else {
        setError(formatApiErrorMessage(err, t));
      }
    } finally {
      setLoading(false);
    }
  };

  /**
   * Submits Step 2 (Password input).
   * If user has MFA, advances to Step 3. Otherwise, completes login.
   */
  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError(t("auth.passwordRequiredFirst", "Please enter your password first"));
      return;
    }

    const hasMfa = hasPasskey || requiresTotp;
    if (hasMfa) {
      // Advance to MFA step with password stored
      setError("");
      setLoginStep(3);
      setMfaMethod(hasPasskey ? "passkey" : "totp");
    } else {
      // No MFA configured: execute login with password alone
      await executeLogin({ useEnteredPassword: true });
    }
  };

  /**
   * Switches directly from Password Step to MFA Step via "Other options".
   */
  const handleSwitchToMfa = () => {
    setPassword("");
    setError("");
    setLoginStep(3);
    setMfaMethod(hasPasskey ? "passkey" : "totp");
  };

  /**
   * Handles Passkey login in Step 3.
   */
  const handlePasskeyLogin = async () => {
    if (!passkeyOptions) return;
    setPasskeyLoading(true);
    setError("");

    try {
      const assertion = await startPasskeyAuthentication(passkeyOptions);
      await executeLogin({
        useEnteredPassword: !!password,
        passkeyAssertion: assertion
      });
    } catch (err: any) {
      console.error("Passkey authentication error:", err);
      setError(formatApiErrorMessage(err, t));
    } finally {
      setPasskeyLoading(false);
    }
  };

  /**
   * Submits Step 3 (TOTP or Recovery Key).
   */
  const handleStep3Submit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (mfaMethod === "totp") {
      const cleanToken = totpToken.replace(/\s/g, "");
      if (cleanToken.length !== 6) {
        setError(t("auth.totpFormatError", "Please enter a valid 6-digit code"));
        return;
      }
      const salt = crypto.randomUUID();
      const hashHex = await hashTotpToken(cleanToken, salt);
      await executeLogin({
        useEnteredPassword: !!password,
        totpTokenHash: hashHex,
        totpSalt: salt
      });
    } else if (mfaMethod === "recovery") {
      const normalizedKey = recoveryKey.replace(/[-\s]/g, "");
      if (!normalizedKey) {
        setError(t("auth.recoveryKeyRequired", "Please enter your recovery key"));
        return;
      }
      await executeLogin({
        useEnteredPassword: !!password,
        recoveryKey: normalizedKey
      });
    }
  };

  /**
   * Navigates back one step.
   */
  const handleBack = () => {
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

  const resetToStep1 = () => {
    setLoginStep(1);
    setPassword("");
    setTotpToken("");
    setRecoveryKey("");
    setError("");
    setTurnstileToken(null);
    setNonce(undefined);
    setServerSalt(undefined);
    setHasPasskey(false);
    setPasskeyOptions(null);
    setPasskeyLoading(false);
    setMfaMethod("passkey");
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
    resetToStep1
  };
};
