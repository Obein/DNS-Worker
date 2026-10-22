import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  initForgotPassword,
  verifyForgotPasswordMfa,
  resetPasswordWithToken
} from "../../services";
import type {
  ForgotPasswordInitResponse,
  ForgotPasswordVerifyPayload
} from "../../services";
import {
  validateUsername,
  validatePassword,
  hashTotpToken,
  hashPasswordClient,
  formatApiErrorMessage
} from "../../utils/auth";
import { startPasskeyAuthentication } from "../../utils/webauthn";
import { useTurnstile } from "../../hooks/useTurnstile";

/**
 * Authentication configuration relevant to login & password recovery.
 */
export interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_login: boolean;
}

/**
 * Props for the useForgotPasswordForm hook.
 */
export interface UseForgotPasswordFormProps {
  /** Whether the modal is currently open. */
  isOpen: boolean;
  /** Optional initial username prefilled in the form. */
  initialUsername?: string;
  /** Server auth config containing Turnstile keys and settings. */
  authConfig: AuthConfig | null;
  /** Whether the cloudflare turnstile script is ready in window. */
  turnstileReady: boolean;
  /** Callback invoked upon successful password reset completion. */
  onSuccess: (username: string) => void;
}

/**
 * Return type definition for the useForgotPasswordForm hook.
 */
export interface UseForgotPasswordFormReturn {
  /** Current step in the reset wizard: 1: username, 2: MFA verify, 3: new password, 4: success. */
  step: 1 | 2 | 3 | 4;
  /** Setter to navigate between steps manually if needed. */
  setStep: React.Dispatch<React.SetStateAction<1 | 2 | 3 | 4>>;
  /** Username input value. */
  username: string;
  /** Setter for username. */
  setUsername: (val: string) => void;
  /** Submission or loading state flag. */
  loading: boolean;
  /** Active error message string. */
  error: string;
  /** Setter to update or clear error message. */
  setError: (val: string) => void;
  /** Whether Turnstile is enabled for login/recovery. */
  isTurnstileEnabled: boolean | undefined;
  /** DOM ref to the Turnstile container element. */
  turnstileRef: React.RefObject<HTMLDivElement | null>;
  /** Resolved Turnstile response token. */
  turnstileToken: string | null;
  /** Verification status of the Turnstile challenge. */
  turnstileStatus: "idle" | "verifying" | "success" | "error";
  /** Initialization response data returned by the server after Step 1. */
  initData: ForgotPasswordInitResponse | null;
  /** Currently selected MFA verification mode in Step 2. */
  mfaMode: "passkey" | "totp" | "recovery";
  /** Setter for MFA mode. */
  setMfaMode: (mode: "passkey" | "totp" | "recovery") => void;
  /** 6-digit TOTP code input value. */
  totpToken: string;
  /** Setter for TOTP code. */
  setTotpToken: (val: string) => void;
  /** 30-digit recovery key value. */
  recoveryKey: string;
  /** Setter for recovery key. */
  setRecoveryKey: (val: string) => void;
  /** Loading state during WebAuthn passkey assertion. */
  passkeyLoading: boolean;
  /** New password input value. */
  newPassword: string;
  /** Setter for new password. */
  setNewPassword: (val: string) => void;
  /** Confirmation password input value. */
  confirmPassword: string;
  /** Setter for confirmation password. */
  setConfirmPassword: (val: string) => void;
  /** Password visibility toggle state. */
  showPassword: boolean;
  /** Setter for password visibility toggle. */
  setShowPassword: (val: boolean) => void;
  /** Form submission handler for Step 1 (username + Turnstile). */
  handleStep1Submit: (e: React.FormEvent) => Promise<void>;
  /** Verification trigger for Step 2 WebAuthn Passkey. */
  handlePasskeyVerify: () => Promise<void>;
  /** Form submission handler for Step 2 (TOTP or Recovery Key). */
  handleMfaSubmit: (e: React.FormEvent) => Promise<void>;
  /** Form submission handler for Step 3 (password reset submission). */
  handleStep3Submit: (e: React.FormEvent) => Promise<void>;
  /** Return to Step 1 to change the username. */
  handleBackToStep1: () => void;
  /** Reset all internal wizard states. */
  resetForm: () => void;
}

/**
 * Custom hook encapsulating state management, Turnstile lifecycle,
 * and API interactions for the multi-step password recovery flow.
 *
 * @param props - Configuration and callbacks.
 * @returns State and event handlers for the password recovery wizard.
 */
export const useForgotPasswordForm = ({
  isOpen,
  initialUsername = "",
  authConfig,
  turnstileReady
}: UseForgotPasswordFormProps): UseForgotPasswordFormReturn => {
  const { t } = useTranslation();

  // Wizard step state: 1: username, 2: verify MFA, 3: set new password, 4: success
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [username, setUsername] = useState<string>(initialUsername);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const isTurnstileEnabled = authConfig?.turnstile_enabled_login;

  const handleClearError = React.useCallback(() => {
    setError("");
  }, []);

  const {
    turnstileToken,
    turnstileStatus,
    turnstileRef,
    resetTurnstile
  } = useTurnstile({
    siteKey: authConfig?.turnstile_site_key,
    enabled: isTurnstileEnabled,
    turnstileReady,
    isActive: isOpen && step === 1,
    onError: setError,
    onClearError: handleClearError
  });

  // Step 1: Server init response
  const [initData, setInitData] = useState<ForgotPasswordInitResponse | null>(null);

  // Step 2: MFA verification state
  const [mfaMode, setMfaMode] = useState<"passkey" | "totp" | "recovery">("passkey");
  const [totpToken, setTotpToken] = useState<string>("");
  const [recoveryKey, setRecoveryKey] = useState<string>("");
  const [passkeyLoading, setPasskeyLoading] = useState<boolean>(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Step 3: Password inputs state
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  /**
   * Resets all internal form states back to initial defaults.
   */
  const resetForm = (): void => {
    setStep(1);
    setUsername(initialUsername);
    setError("");
    setInitData(null);
    setResetToken(null);
    setTotpToken("");
    setRecoveryKey("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPassword(false);
    resetTurnstile();
  };

  // Sync initial username and clear states when modal opens
  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, initialUsername]);

  /**
   * Step 1: Submit Username and initialize password recovery flow.
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

    setLoading(true);
    setError("");

    try {
      const data = await initForgotPassword(username, turnstileToken);
      setInitData(data);
      if (data.has_passkey) {
        setMfaMode("passkey");
      } else if (data.has_totp) {
        setMfaMode("totp");
      } else {
        setMfaMode("recovery");
      }
      setStep(2);
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 2: Passkey authentication verification.
   */
  const handlePasskeyVerify = async (): Promise<void> => {
    if (!initData?.recoveryToken || !initData.passkey_options) return;
    setPasskeyLoading(true);
    setError("");

    try {
      const assertion = await startPasskeyAuthentication(initData.passkey_options);
      const res = await verifyForgotPasswordMfa({
        recoveryToken: initData.recoveryToken,
        passkeyAssertion: assertion
      });
      setResetToken(res.resetToken);
      setStep(3);
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setPasskeyLoading(false);
    }
  };

  /**
   * Step 2: TOTP / Recovery Key verification.
   */
  const handleMfaSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!initData?.recoveryToken) return;

    setLoading(true);
    setError("");

    try {
      const payload: ForgotPasswordVerifyPayload = {
        recoveryToken: initData.recoveryToken
      };

      if (mfaMode === "totp") {
        const salt = crypto.randomUUID();
        const hashHex = await hashTotpToken(totpToken, salt);
        payload.totpTokenHash = hashHex;
        payload.totpSalt = salt;
      } else if (mfaMode === "recovery") {
        payload.recoveryKey = recoveryKey.trim();
      }

      const res = await verifyForgotPasswordMfa(payload);
      setResetToken(res.resetToken);
      setStep(3);
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Step 3: Submit New Password with client-side hashing.
   */
  const handleStep3Submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!resetToken) return;

    if (!validatePassword(newPassword)) {
      setError(t("auth.formatTipPassword"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("auth.passwordMismatch", "Passwords do not match"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const clientHash = await hashPasswordClient(newPassword, username);
      await resetPasswordWithToken(resetToken, clientHash);
      setStep(4);
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  /**
   * Return back to Step 1 to change the username.
   */
  const handleBackToStep1 = (): void => {
    setStep(1);
    setError("");
  };

  return {
    step,
    setStep,
    username,
    setUsername,
    loading,
    error,
    setError,
    isTurnstileEnabled,
    turnstileRef,
    turnstileToken,
    turnstileStatus,
    initData,
    mfaMode,
    setMfaMode,
    totpToken,
    setTotpToken,
    recoveryKey,
    setRecoveryKey,
    passkeyLoading,
    newPassword,
    setNewPassword,
    confirmPassword,
    setConfirmPassword,
    showPassword,
    setShowPassword,
    handleStep1Submit,
    handlePasskeyVerify,
    handleMfaSubmit,
    handleStep3Submit,
    handleBackToStep1,
    resetForm
  };
};
