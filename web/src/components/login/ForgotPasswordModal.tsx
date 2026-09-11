import React, { useState, useEffect, useRef } from "react";
import {
  Dialog,
  FormGroup,
  InputGroup,
  Button,
  Intent,
  Callout
} from "@blueprintjs/core";
import { Key, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DigitInput } from "../DigitInput";
import {
  initForgotPassword,
  verifyForgotPasswordMfa,
  resetPasswordWithToken
} from "../../services";
import type { ForgotPasswordInitResponse } from "../../services";
import {
  validateUsername,
  validatePassword,
  hashTotpToken,
  hashPasswordClient,
  formatApiErrorMessage
} from "../../utils/auth";
import { startPasskeyAuthentication } from "../../utils/webauthn";

interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_login: boolean;
}

export interface ForgotPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUsername?: string;
  authConfig: AuthConfig | null;
  turnstileReady: boolean;
  onSuccess: (username: string) => void;
}

export const ForgotPasswordModal: React.FC<ForgotPasswordModalProps> = ({
  isOpen,
  onClose,
  initialUsername = "",
  authConfig,
  turnstileReady,
  onSuccess
}) => {
  const { t } = useTranslation();

  // Wizard state: 1: username, 2: verify MFA, 3: set new password, 4: success
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [username, setUsername] = useState(initialUsername);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Step 1 Turnstile & response
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [, setTurnstileStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const isTurnstileEnabled = authConfig?.turnstile_enabled_login;

  const [initData, setInitData] = useState<ForgotPasswordInitResponse | null>(null);

  // Step 2 MFA state
  const [mfaMode, setMfaMode] = useState<"passkey" | "totp" | "recovery">("passkey");
  const [totpToken, setTotpToken] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  // Step 3 Password state
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Sync initial username when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep(1);
      setUsername(initialUsername);
      setError("");
      setInitData(null);
      setResetToken(null);
      setTotpToken("");
      setRecoveryKey("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }, [isOpen, initialUsername]);

  // Turnstile initialization for Step 1
  useEffect(() => {
    if (
      isOpen &&
      step === 1 &&
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
          "error-callback": () => {
            setTurnstileStatus("error");
            setError(t("auth.turnstileError", "Verification service failed to load."));
            setTurnstileToken(null);
          }
        });
        widgetIdRef.current = widgetId;
      } catch (e) {
        console.error("Turnstile render error:", e);
      }
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [isOpen, step, isTurnstileEnabled, authConfig, turnstileReady, t]);

  // Step 1: Submit Username
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
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
      if (window.turnstile) window.turnstile.reset();
      setTurnstileToken(null);
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Passkey verification
  const handlePasskeyVerify = async () => {
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
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setPasskeyLoading(false);
    }
  };

  // Step 2: TOTP / Recovery Key verification
  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!initData?.recoveryToken) return;
    setLoading(true);
    setError("");

    try {
      const payload: any = { recoveryToken: initData.recoveryToken };
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
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Submit New Password
  const handleStep3Submit = async (e: React.FormEvent) => {
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
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("auth.forgotPasswordTitle", "Reset Password")}
      className="max-w-md w-full rounded-2xl"
    >
      <div className="p-6 space-y-4">
        {error && (
          <Callout intent={Intent.DANGER} className="rounded-xl">
            {error}
          </Callout>
        )}

        {/* ─── Step 1: Input Username ─── */}
        {step === 1 && (
          <form onSubmit={handleStep1Submit} className="space-y-4">
            <p className="text-sm text-gray-500">
              {t("auth.forgotPasswordDesc", "Enter your username to begin identity verification.")}
            </p>
            <FormGroup label={t("auth.username")} labelFor="forgot-username">
              <InputGroup
                id="forgot-username"
                leftIcon="user"
                placeholder={t("auth.usernamePlaceholder")}
                size="large"
                className="rounded-xl"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </FormGroup>

            {isTurnstileEnabled && authConfig?.turnstile_site_key && (
              <div className="my-2 flex justify-center">
                <div ref={turnstileRef} className="min-h-[65px]" />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button minimal text={t("common.cancel", "Cancel")} onClick={onClose} />
              <Button
                intent={Intent.PRIMARY}
                type="submit"
                loading={loading}
                disabled={isTurnstileEnabled && !turnstileToken}
                text={t("common.continue", "Continue")}
              />
            </div>
          </form>
        )}

        {/* ─── Step 2: MFA Verification ─── */}
        {step === 2 && initData && (
          <div className="space-y-4">
            {!initData.can_reset ? (
              <Callout intent={Intent.WARNING} icon="warning-sign" className="rounded-xl">
                <p className="text-sm font-medium">
                  {t(
                    "auth.noMfaContactAdmin",
                    "This account has no multi-factor authentication (MFA) or recovery keys configured and cannot be self-reset. Please contact your administrator to reset your password."
                  )}
                </p>
                <div className="mt-4 flex justify-end">
                  <Button intent={Intent.NONE} text={t("common.close", "Close")} onClick={onClose} />
                </div>
              </Callout>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
                  >
                    <ArrowLeft size={14} />
                    <span>{username}</span>
                  </button>
                  <span className="text-xs text-gray-400">
                    {t("auth.verifyIdentity", "Verify Identity")}
                  </span>
                </div>

                <p className="text-sm text-gray-500">
                  {t(
                    "auth.chooseMfaForReset",
                    "Authenticate using one of your configured MFA methods to verify your identity."
                  )}
                </p>

                {/* Passkey option */}
                {initData.has_passkey && (
                  <Button
                    fill
                    size="large"
                    intent={Intent.PRIMARY}
                    type="button"
                    loading={passkeyLoading}
                    disabled={loading}
                    onClick={handlePasskeyVerify}
                    className="font-semibold py-4 rounded-xl shadow-sm flex items-center justify-center space-x-2"
                  >
                    <Key size={18} className="inline mr-1.5" />
                    <span>{t("auth.verifyWithPasskey", "Verify with Passkey")}</span>
                  </Button>
                )}

                {(initData.has_totp || initData.has_recovery_keys) && initData.has_passkey && (
                  <div className="relative flex py-1 items-center">
                    <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                    <span className="flex-shrink mx-3 text-gray-400 text-xs">
                      {t("auth.orUseOtherMfa", "or use another method")}
                    </span>
                    <div className="flex-grow border-t border-gray-200 dark:border-gray-700"></div>
                  </div>
                )}

                {/* TOTP / Recovery Key Form */}
                {(initData.has_totp || initData.has_recovery_keys) && (
                  <form onSubmit={handleMfaSubmit} className="space-y-4">
                    {mfaMode === "totp" && initData.has_totp && (
                      <FormGroup label={t("auth.totpVerification", "Two-Factor Code (TOTP)")}>
                        <DigitInput
                          length={6}
                          value={totpToken}
                          onChange={setTotpToken}
                          disabled={loading || passkeyLoading}
                          autoFocus={!initData.has_passkey}
                        />
                      </FormGroup>
                    )}

                    {mfaMode === "recovery" && initData.has_recovery_keys && (
                      <FormGroup label={t("account.totp.recoveryKeysTitle", "Recovery Key")}>
                        <InputGroup
                          id="forgot-recovery-key"
                          leftIcon="key"
                          placeholder="XXXXXXXXXX"
                          size="large"
                          className="rounded-xl font-mono tracking-widest"
                          value={recoveryKey}
                          onChange={(e) => setRecoveryKey(e.target.value)}
                          required
                          autoFocus
                        />
                      </FormGroup>
                    )}

                    <div className="flex justify-between items-center text-xs">
                      {initData.has_totp && initData.has_recovery_keys && (
                        <button
                          type="button"
                          onClick={() => setMfaMode(mfaMode === "totp" ? "recovery" : "totp")}
                          className="text-blue-600 hover:underline bg-transparent border-none cursor-pointer p-0"
                        >
                          {mfaMode === "totp"
                            ? t("auth.totpUseRecovery", "Use Recovery Key")
                            : t("auth.totpUseApp", "Use Authenticator App")}
                        </button>
                      )}
                    </div>

                    <Button
                      fill
                      size="large"
                      intent={initData.has_passkey ? Intent.NONE : Intent.PRIMARY}
                      type="submit"
                      loading={loading}
                      disabled={passkeyLoading}
                      className="rounded-xl font-semibold"
                    >
                      {t("auth.verifyIdentity", "Verify Identity")}
                    </Button>
                  </form>
                )}
              </>
            )}
          </div>
        )}

        {/* ─── Step 3: Set New Password ─── */}
        {step === 3 && (
          <form onSubmit={handleStep3Submit} className="space-y-4">
            <p className="text-sm text-gray-500">
              {t("auth.setNewPasswordDesc", "Identity verified. Please set your new account password.")}
            </p>

            <FormGroup label={t("account.newPassword")} labelFor="forgot-new-password">
              <InputGroup
                id="forgot-new-password"
                leftIcon="lock"
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.formatTipPassword")}
                size="large"
                className="rounded-xl"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoFocus
                required
                rightElement={
                  <Button
                    minimal
                    icon={showPassword ? "eye-open" : "eye-off"}
                    onClick={() => setShowPassword(!showPassword)}
                  />
                }
              />
            </FormGroup>

            <FormGroup label={t("auth.confirmNewPassword", "Confirm New Password")} labelFor="forgot-confirm-password">
              <InputGroup
                id="forgot-confirm-password"
                leftIcon="lock"
                type={showPassword ? "text" : "password"}
                placeholder={t("auth.formatTipPassword")}
                size="large"
                className="rounded-xl"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </FormGroup>

            <div className="flex justify-end gap-2 pt-2">
              <Button minimal text={t("common.cancel", "Cancel")} onClick={onClose} />
              <Button
                intent={Intent.PRIMARY}
                type="submit"
                loading={loading}
                text={t("account.updatePassword", "Update Password")}
              />
            </div>
          </form>
        )}

        {/* ─── Step 4: Success ─── */}
        {step === 4 && (
          <div className="space-y-5 text-center py-4">
            <div className="flex justify-center text-green-500">
              <CheckCircle2 size={48} />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100">
                {t("auth.resetSuccessTitle", "Password Reset Complete")}
              </h3>
              <p className="text-sm text-gray-500">
                {t("auth.resetSuccessDesc", "Your password has been successfully updated. All previous sessions have been signed out.")}
              </p>
            </div>
            <Button
              fill
              size="large"
              intent={Intent.PRIMARY}
              onClick={() => {
                onClose();
                onSuccess(username);
              }}
              className="rounded-xl font-bold py-3"
            >
              {t("auth.goToLogin", "Log In with New Password")}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
};
