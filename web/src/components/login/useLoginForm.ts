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
 * Custom hook to manage LoginForm's state and submissions.
 *
 * @param props - Hook props.
 * @returns State and event handlers for LoginForm.
 */
export const useLoginForm = ({
  authConfig,
  turnstileReady,
  onSuccess
}: UseLoginFormProps) => {
  const [loginStep, setLoginStep] = useState<1 | 2>(1);

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
  const [useRecovery, setUseRecovery] = useState(false);

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
      setLoginStep(2);
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
      if (window.turnstile) window.turnstile.reset();
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const body: {
        password?: string;
        recoveryKey?: string;
        totpTokenHash?: string;
        totpSalt?: string;
        keepLoggedIn?: boolean;
      } = {
        keepLoggedIn
      };
      if (requiresPassword) {
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
      if (requiresTotp) {
        if (useRecovery) {
          body.recoveryKey = recoveryKey;
        } else {
          const salt = crypto.randomUUID();
          const hashHex = await hashTotpToken(totpToken, salt);
          body.totpTokenHash = hashHex;
          body.totpSalt = salt;
        }
      }

      const data = await login(body);
      if (data.accessToken) {
        setAccessToken(data.accessToken);
      }
      if (data.needsMigration) {
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

  const handlePasskeyLogin = async () => {
    if (!passkeyOptions) return;
    setPasskeyLoading(true);
    setError("");

    try {
      const assertion = await startPasskeyAuthentication(passkeyOptions);
      const body: {
        password?: string;
        passkeyAssertion?: any;
        keepLoggedIn?: boolean;
      } = {
        keepLoggedIn,
        passkeyAssertion: assertion
      };

      if (requiresPassword) {
        if (!password) {
          setError(t("auth.passwordRequiredFirst", "Please enter your password first"));
          setPasskeyLoading(false);
          return;
        }
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
      console.error("Passkey authentication error:", err);
      setError(formatApiErrorMessage(err, t));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const resetToStep1 = () => {
    setLoginStep(1);
    setPassword("");
    setTotpToken("");
    setRecoveryKey("");
    setError("");
    setTurnstileToken(null);
    setUseRecovery(false);
    setNonce(undefined);
    setServerSalt(undefined);
    setHasPasskey(false);
    setPasskeyOptions(null);
    setPasskeyLoading(false);
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
    passkeyLoading,
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
    handlePasskeyLogin,
    resetToStep1
  };
};
