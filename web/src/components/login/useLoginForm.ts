import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  validateUsername,
  isPasswordLeaked,
  hashTotpToken
} from "../../utils/auth";

interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
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

  // Server response step requirements
  const [requiresPassword, setRequiresPassword] = useState(true);
  const [requiresTotp, setRequiresTotp] = useState(false);
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
      const res = await fetch("/api/auth/prelogin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, turnstileToken })
      });

      if (res.ok) {
        const data = await res.json();
        setRequiresPassword(data.requires_password);
        setRequiresTotp(data.requires_totp);
        setLoginStep(2);
      } else {
        const msg = await res.text();
        setError(msg || t("auth.authFailed"));
        if (window.turnstile) window.turnstile.reset();
        setTurnstileToken(null);
      }
    } catch (err) {
      setError(t("auth.networkError"));
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
      } = {};
      if (requiresPassword) body.password = password;
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

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        onSuccess();
      } else {
        const msg = await res.text();
        if (isPasswordLeaked(res, msg)) {
          setError(t("auth.passwordLeaked"));
        } else {
          setError(msg || t("auth.authFailed"));
        }
      }
    } catch (err) {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
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
    useRecovery,
    setUseRecovery,
    loading,
    error,
    setError,
    turnstileStatus,
    turnstileRef,
    isTurnstileEnabled,
    handleStep1Submit,
    handleStep2Submit,
    resetToStep1
  };
};
