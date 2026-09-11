import React from "react";
import { FormGroup, Button, Intent, Checkbox } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { Key, KeyRound } from "lucide-react";
import { DigitInput } from "../DigitInput";
import { RecoveryKeyInput } from "../RecoveryKeyInput";

/**
 * Properties for the LoginMfaStep component.
 */
export interface LoginMfaStepProps {
  /** True if user has registered passkeys. */
  hasPasskey: boolean;
  /** True if user has TOTP enabled. */
  requiresTotp: boolean;
  /** Current active MFA method. */
  mfaMethod: "passkey" | "totp" | "recovery";
  /** Callback to change active MFA method. */
  setMfaMethod: (method: "passkey" | "totp" | "recovery") => void;
  /** True if passkey authentication is actively in progress. */
  passkeyLoading: boolean;
  /** Callback to trigger passkey authentication. */
  onPasskeyLogin: () => void;
  /** Current 6-digit TOTP token input value. */
  totpToken: string;
  /** Callback to update TOTP token value. */
  setTotpToken: (val: string) => void;
  /** Current 30-digit recovery key value. */
  recoveryKey: string;
  /** Callback to update recovery key value. */
  setRecoveryKey: (val: string) => void;
  /** True if submission is loading. */
  loading: boolean;
  /** Callback to reset or clear errors when modes switch. */
  onClearError: () => void;
  /** Callback to handle the form submission. */
  onSubmit: (e: React.FormEvent) => void;
  /** Whether the user wants to stay logged in. */
  keepLoggedIn: boolean;
  /** Callback to toggle stay logged in. */
  setKeepLoggedIn: (val: boolean) => void;
  /** Optional session expiration duration in days. */
  optionalSessionExpirationDays: number;
}

/**
 * LoginMfaStep renders the dedicated MFA authentication step.
 * It prioritizes Passkey authentication if configured, provides an "Other options"
 * button to switch between Passkey and TOTP, and supports 30-digit recovery key entry.
 */
export const LoginMfaStep: React.FC<LoginMfaStepProps> = ({
  hasPasskey,
  requiresTotp,
  mfaMethod,
  setMfaMethod,
  passkeyLoading,
  onPasskeyLogin,
  totpToken,
  setTotpToken,
  recoveryKey,
  setRecoveryKey,
  loading,
  onClearError,
  onSubmit,
  keepLoggedIn,
  setKeepLoggedIn,
  optionalSessionExpirationDays
}) => {
  const { t } = useTranslation();

  const handleSwitchMode = (target: "passkey" | "totp" | "recovery") => {
    setMfaMethod(target);
    onClearError();
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mfaMethod === "passkey") {
      onPasskeyLogin();
      return;
    }
    onSubmit(e);
  };

  return (
    <form onSubmit={handleFormSubmit} className="space-y-4">
      {/* ─── Mode: Passkey (Priority) ─── */}
      {mfaMethod === "passkey" && (
        <div className="space-y-5 text-center py-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Key size={36} />
          </div>

          <div className="space-y-1">
            <h4 className="text-base font-semibold text-gray-900 dark:text-gray-100 m-0">
              {t("auth.passkeyVerification", "通行密钥验证")}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 max-w-xs mx-auto leading-relaxed">
              {t("auth.passkeyPromptDesc", "使用已注册的设备生物识别或硬件安全密钥进行验证")}
            </p>
          </div>

          <Checkbox
            checked={keepLoggedIn}
            onChange={(e) => setKeepLoggedIn(e.currentTarget.checked)}
            label={t("auth.keepLoggedIn", "Keep me logged in for {{days}} days", {
              days: optionalSessionExpirationDays
            })}
            className="text-left inline-block mt-2"
          />

          <div className="pt-2 space-y-3">
            <Button
              fill
              size="large"
              intent={Intent.PRIMARY}
              type="button"
              loading={passkeyLoading}
              disabled={loading}
              onClick={onPasskeyLogin}
              className="font-semibold py-6 rounded-xl shadow-lg shadow-blue-500/20 flex items-center justify-center space-x-2"
            >
              <Key size={20} className="inline mr-1.5" />
              <span>{t("auth.verifyWithPasskey", "使用通行密钥验证")}</span>
            </Button>

            {requiresTotp && (
              <Button
                fill
                minimal
                size="large"
                type="button"
                disabled={passkeyLoading || loading}
                onClick={() => handleSwitchMode("totp")}
                className="font-medium text-blue-600 dark:text-blue-400 py-2.5 rounded-xl transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30"
              >
                {t("auth.otherOptions", "其他选项")}
              </Button>
            )}

            <div className="pt-1">
              <button
                type="button"
                onClick={() => handleSwitchMode("recovery")}
                className="text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:underline bg-transparent border-none cursor-pointer p-0 font-normal inline-flex items-center gap-1"
              >
                <KeyRound size={12} />
                <span>{t("auth.totpUseRecovery", "使用恢复密钥")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Mode: TOTP ─── */}
      {mfaMethod === "totp" && (
        <div className="space-y-4">
          <FormGroup
            label={t("account.totp.title", "数字验证器 (TOTP)")}
            helperText={t("auth.totpPrompt", "请输入身份验证应用中的 6 位动态验证码")}
          >
            <div className="pt-2">
              <DigitInput
                length={6}
                value={totpToken}
                onChange={setTotpToken}
                disabled={loading}
                autoFocus
              />
            </div>
          </FormGroup>

          <Checkbox
            checked={keepLoggedIn}
            onChange={(e) => setKeepLoggedIn(e.currentTarget.checked)}
            label={t("auth.keepLoggedIn", "Keep me logged in for {{days}} days", {
              days: optionalSessionExpirationDays
            })}
            className="mt-4 text-left"
          />

          <div className="pt-2 space-y-3">
            <Button
              fill
              size="large"
              intent={Intent.PRIMARY}
              type="submit"
              loading={loading}
              className="font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
            >
              {t("auth.loginBtn", "登录")}
            </Button>

            {hasPasskey && (
              <Button
                fill
                minimal
                size="large"
                type="button"
                disabled={loading}
                onClick={() => handleSwitchMode("passkey")}
                className="font-medium text-blue-600 dark:text-blue-400 py-2.5 rounded-xl transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30"
              >
                {t("auth.otherOptions", "其他选项")}
              </Button>
            )}

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => handleSwitchMode("recovery")}
                className="text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 hover:underline bg-transparent border-none cursor-pointer p-0 font-normal inline-flex items-center gap-1"
              >
                <KeyRound size={12} />
                <span>{t("auth.totpUseRecovery", "使用恢复密钥")}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Mode: Recovery Key ─── */}
      {mfaMethod === "recovery" && (
        <div className="space-y-4">
          <FormGroup
            label={t("account.totp.recoveryKeysTitle", "应急恢复密钥")}
            helperText={t("auth.recoveryPrompt", "请输入 30 位应急恢复密钥（5 组，每组 6 位数字）")}
          >
            <div className="pt-2">
              <RecoveryKeyInput
                value={recoveryKey}
                onChange={setRecoveryKey}
                disabled={loading}
                autoFocus
              />
            </div>
          </FormGroup>

          <Checkbox
            checked={keepLoggedIn}
            onChange={(e) => setKeepLoggedIn(e.currentTarget.checked)}
            label={t("auth.keepLoggedIn", "Keep me logged in for {{days}} days", {
              days: optionalSessionExpirationDays
            })}
            className="mt-4 text-left"
          />

          <div className="pt-2 space-y-3">
            <Button
              fill
              size="large"
              intent={Intent.PRIMARY}
              type="submit"
              loading={loading}
              className="font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
            >
              {t("auth.loginBtn", "登录")}
            </Button>

            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => handleSwitchMode(hasPasskey ? "passkey" : "totp")}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline bg-transparent border-none cursor-pointer p-0 font-normal"
              >
                {hasPasskey
                  ? t("auth.backToPasskey", "返回通行密钥验证")
                  : t("auth.totpUseApp", "使用身份验证器")}
              </button>
            </div>
          </div>
        </div>
      )}
    </form>
  );
};
