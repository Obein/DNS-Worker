import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  validateUsername,
  validatePassword,
  isPasswordLeaked
} from "../../utils/auth";
import {
  checkUsernameDuplicateApi,
  startSignupTotpSetupApi,
  confirmSignupTotpApi,
  signupSubmitApi
} from "./signupApi";

interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
}

export interface UseSignupWizardProps {
  authConfig: AuthConfig | null;
  turnstileReady: boolean;
  onSuccess: () => void;
}

/**
 * Custom hook to manage SignupWizard's state and workflow submissions.
 *
 * @param props - Hook props.
 * @returns State and event handlers for SignupWizard.
 */
export const useSignupWizard = ({
  authConfig,
  turnstileReady,
  onSuccess
}: UseSignupWizardProps) => {
  const [signupStep, setSignupStep] = useState<
    "username" | "password" | "totp" | "recovery"
  >("username");

  // Input states
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpSetupToken, setTotpSetupToken] = useState("");

  // TOTP response states
  const [totpSetupData, setTotpSetupData] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [totpRecoveryKeys, setTotpRecoveryKeys] = useState<string[] | null>(
    null
  );

  // Status indicators
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [copiedRecovery, setCopiedRecovery] = useState(false);

  // Setup/verification loading indicators
  const [totpSetupLoading, setTotpSetupLoading] = useState(false);
  const [totpSetupError, setTotpSetupError] = useState("");

  // Turnstile state
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<
    "idle" | "verifying" | "success" | "error"
  >("idle");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const { t } = useTranslation();

  const isTurnstileEnabled = authConfig?.turnstile_enabled_signup;

  useEffect(() => {
    // Only render turnstile in Step 1 (username step)
    if (
      signupStep === "username" &&
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
  }, [isTurnstileEnabled, authConfig, signupStep, turnstileReady, t]);

  const checkUsernameDuplicate = async (uname: string) => {
    if (!uname || !validateUsername(uname)) return;
    try {
      const exists = await checkUsernameDuplicateApi(uname);
      if (exists) {
        setError(t("auth.usernameExists"));
      } else {
        setError((prev) => (prev === t("auth.usernameExists") ? "" : prev));
      }
    } catch (e) {
      console.error("Failed to check username duplicate", e);
    }
  };

  const handleSignupUsernameSubmit = async (e: React.FormEvent) => {
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
      const exists = await checkUsernameDuplicateApi(username);
      if (exists) {
        setError(t("auth.usernameExists"));
      } else {
        setSignupStep("password");
      }
    } catch (err) {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  };

  const startSignupTotpSetup = async () => {
    setTotpSetupLoading(true);
    setTotpSetupError("");
    try {
      const data = await startSignupTotpSetupApi();
      setTotpSetupData(data);
      setSignupStep("totp");
    } catch (e) {
      console.error("Network error during signup TOTP setup:", e);
      onSuccess();
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const handleSignupTotpConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetupData) return;
    setTotpSetupLoading(true);
    setTotpSetupError("");
    try {
      const data = await confirmSignupTotpApi(
        totpSetupData.secret,
        totpSetupToken
      );
      setTotpRecoveryKeys(data.recovery_keys);
      setSignupStep("recovery");
    } catch (err: any) {
      setTotpSetupError(err.message || t("common.errorNetwork"));
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const handleCopySignupRecoveryKeys = () => {
    if (!totpRecoveryKeys) return;
    navigator.clipboard.writeText(totpRecoveryKeys.join("\n")).then(() => {
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    });
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateUsername(username)) {
      setError(t("auth.formatTipUsername"));
      return;
    }
    if (!validatePassword(password)) {
      setError(t("auth.formatTipPassword"));
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await signupSubmitApi({
        username,
        password,
        turnstileToken
      });

      if (res.ok) {
        await startSignupTotpSetup();
      } else {
        const msg = await res.text();
        if (isPasswordLeaked(res, msg)) {
          setError(t("auth.passwordLeaked"));
        } else if (msg === "username_exists") {
          setError(t("auth.usernameExists"));
        } else {
          setError(msg || t("auth.authFailed"));
        }
        if (window.turnstile) window.turnstile.reset();
        setTurnstileToken(null);
      }
    } catch (err) {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return {
    signupStep,
    setSignupStep,
    username,
    setUsername,
    password,
    setPassword,
    totpSetupToken,
    setTotpSetupToken,
    totpSetupData,
    setTotpSetupData,
    totpRecoveryKeys,
    setTotpRecoveryKeys,
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
  };
};
