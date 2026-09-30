import React, { useState, useEffect } from "react";
import {
  Dialog,
  Button,
  FormGroup,
  InputGroup,
  Intent,
  Callout,
  ButtonGroup,
  Classes
} from "@blueprintjs/core";
import { Key, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DigitInput } from "../../../components/DigitInput";
import { hashPasswordClient, formatApiErrorMessage } from "../../../utils/auth";
import { getPasskeyAuthOptions, type VerifyIdentityPayload } from "../../../services/account";
import { startPasskeyAuthentication } from "../../../utils/webauthn";
import type { UserInfo } from "../types";

export interface VerifyIdentityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserInfo | null;
  title?: string;
  onVerify: (payload: VerifyIdentityPayload) => Promise<void>;
}

export type AuthMethod = "password" | "passkey" | "totp" | "recovery_key";

export interface VerifyIdentityDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserInfo | null;
  title?: string;
  onVerify: (payload: VerifyIdentityPayload) => Promise<void>;
  allowedMethods?: AuthMethod[];
}

/**
 * Computes default verification method prioritized by Passkey -> Recovery Key -> TOTP -> Password.
 */
const getInitialMethod = (user: UserInfo | null, allowedMethods?: AuthMethod[]): AuthMethod => {
  const allowed = allowedMethods || ["passkey", "totp", "password"];
  if (allowed.includes("passkey") && user?.passkeys_count && user.passkeys_count > 0) return "passkey";
  if (allowed.includes("recovery_key")) return "recovery_key";
  if (allowed.includes("totp") && user?.totp_enabled) return "totp";
  if (allowed.includes("password")) return "password";
  return allowed[0] || "password";
};

export const VerifyIdentityDialog: React.FC<VerifyIdentityDialogProps> = ({
  isOpen,
  onClose,
  user,
  title,
  onVerify,
  allowedMethods
}) => {
  const { t } = useTranslation();

  const allowed = allowedMethods || ["passkey", "totp", "password"];
  const hasPasskey = !!(user?.passkeys_count && user.passkeys_count > 0) && allowed.includes("passkey");
  const hasTotp = !!user?.totp_enabled && allowed.includes("totp");
  const hasPassword = allowed.includes("password");
  const hasRecoveryKey = allowed.includes("recovery_key");

  const defaultMethod = getInitialMethod(user, allowedMethods);

  const [method, setMethod] = useState<AuthMethod>(defaultMethod);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Synchronously reset and synchronize state during render when dialog opens (eliminates delay/animation lag)
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (!prevIsOpen && isOpen) {
    setPrevIsOpen(true);
    setMethod(defaultMethod);
    setPassword("");
    setShowPassword(false);
    setTotpCode("");
    setRecoveryKey("");
    setError("");
  } else if (prevIsOpen && !isOpen) {
    setPrevIsOpen(false);
  }

  // Ensure selected method remains valid if user capabilities change dynamically
  useEffect(() => {
    if (method === "passkey" && !hasPasskey) {
      setMethod(hasRecoveryKey ? "recovery_key" : hasTotp ? "totp" : "password");
    } else if (method === "totp" && !hasTotp) {
      setMethod(hasPasskey ? "passkey" : hasRecoveryKey ? "recovery_key" : "password");
    } else if (method === "recovery_key" && !hasRecoveryKey) {
      setMethod(hasPasskey ? "passkey" : hasTotp ? "totp" : "password");
    }
  }, [hasPasskey, hasTotp, hasRecoveryKey, method]);

  const handleVerifyPassword = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password) {
      setError(t("auth.passwordRequired", "Password is required"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      let pwd = password;
      if (user?.password_version === 2 && user?.username) {
        pwd = await hashPasswordClient(password, user.username);
      }
      await onVerify({ password: pwd });
      onClose();
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPasskey = async () => {
    setLoading(true);
    setError("");
    try {
      const options = await getPasskeyAuthOptions();
      const passkeyAssertion = await startPasskeyAuthentication(options);
      await onVerify({ passkeyAssertion });
      onClose();
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTotp = async (codeValue?: string) => {
    const code = codeValue || totpCode;
    if (code.length !== 6) {
      setError(t("account.totp.invalidCode", "Please enter a 6-digit code"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      const salt = crypto.randomUUID();
      const msgBuffer = new TextEncoder().encode(code + salt);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      await onVerify({ totpTokenHash: hashHex, totpSalt: salt });
      onClose();
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRecoveryKey = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const key = recoveryKey.trim();
    if (!key) {
      setError(t("account.recoveryKey.keyRequired", "Recovery key is required"));
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onVerify({ recoveryKey: key });
      onClose();
    } catch (err: any) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const methodCount = (hasPasskey ? 1 : 0) + (hasRecoveryKey ? 1 : 0) + (hasTotp ? 1 : 0) + (hasPassword ? 1 : 0);

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={title || t("account.verifyIdentity", "Security Verification")}
      icon="shield"
      className="max-w-md w-full"
    >
      <div className={Classes.DIALOG_BODY}>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t(
            "account.verifyIdentityDesc",
            "To protect your account security, please verify your identity before proceeding."
          )}
        </p>

        {/* Method Selector if multiple methods available */}
        {methodCount > 1 && (
          <div className="flex justify-center mb-5 isolate" style={{ isolation: "isolate" }}>
            <div className="w-full bg-gray-100/70 dark:bg-gray-800/70 p-1 rounded-lg">
              <ButtonGroup fill variant="minimal" style={{ isolation: "isolate" }}>
                {hasPasskey && (
                  <Button
                    small
                    active={method === "passkey"}
                    intent={method === "passkey" ? Intent.PRIMARY : Intent.NONE}
                    icon={<Key size={14} />}
                    text={t("account.mfa.passkey", "Passkey")}
                    onClick={() => {
                      setMethod("passkey");
                      setError("");
                    }}
                  />
                )}
                {hasRecoveryKey && (
                  <Button
                    small
                    active={method === "recovery_key"}
                    intent={method === "recovery_key" ? Intent.PRIMARY : Intent.NONE}
                    icon={<Key size={14} />}
                    text={t("account.recoveryKey.verifyBtn", "Recovery Key")}
                    onClick={() => {
                      setMethod("recovery_key");
                      setError("");
                    }}
                  />
                )}
                {hasTotp && (
                  <Button
                    small
                    active={method === "totp"}
                    intent={method === "totp" ? Intent.PRIMARY : Intent.NONE}
                    icon={<ShieldCheck size={14} />}
                    text={t("account.mfa.totp", "TOTP")}
                    onClick={() => {
                      setMethod("totp");
                      setError("");
                    }}
                  />
                )}
                {hasPassword && (
                  <Button
                    small
                    active={method === "password"}
                    intent={method === "password" ? Intent.PRIMARY : Intent.NONE}
                    icon={<Lock size={14} />}
                    text={t("account.mfa.password", "Password")}
                    onClick={() => {
                      setMethod("password");
                      setError("");
                    }}
                  />
                )}
              </ButtonGroup>
            </div>
          </div>
        )}

        {error && (
          <Callout intent={Intent.DANGER} className="mb-4">
            {error}
          </Callout>
        )}

        {method === "recovery_key" && (
          <form onSubmit={handleVerifyRecoveryKey} className="py-2 space-y-4">
            <FormGroup label={t("account.recoveryKey.verifyPromptLabel", "原恢复密钥 (Original Recovery Key)")}>
              <InputGroup
                leftIcon="key"
                type="text"
                placeholder="123456-789012-345678-901234-567890"
                value={recoveryKey}
                onChange={(e) => setRecoveryKey(e.target.value)}
                autoFocus
                className="font-mono text-xs"
              />
            </FormGroup>
            <Button
              fill
              intent={Intent.PRIMARY}
              type="submit"
              loading={loading}
              disabled={!recoveryKey.trim()}
              text={t("common.confirm", "Confirm")}
            />
          </form>
        )}

        {method === "passkey" && (
          <div className="text-center py-4 space-y-4">
            <div className="flex justify-center">
              <div className="p-4 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-500">
                <Key size={48} />
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {t(
                "account.passkey.verifyPrompt",
                "Authenticate using your device's biometric sensor (Face ID, Touch ID, Windows Hello) or security key."
              )}
            </p>
            <Button
              fill
              large
              intent={Intent.PRIMARY}
              loading={loading}
              onClick={handleVerifyPasskey}
              icon={<Key size={16} />}
              text={t("account.usePasskeyInstead", "Authenticate with Passkey")}
            />
          </div>
        )}

        {method === "totp" && (
          <div className="py-2 space-y-4">
            <FormGroup label={t("account.totpCode", "Authenticator Code")}>
              <DigitInput
                length={6}
                value={totpCode}
                onChange={(val) => {
                  setTotpCode(val);
                  if (val.length === 6) {
                    handleVerifyTotp(val);
                  }
                }}
                disabled={loading}
              />
            </FormGroup>
            <Button
              fill
              intent={Intent.PRIMARY}
              loading={loading}
              disabled={totpCode.length !== 6}
              onClick={() => handleVerifyTotp()}
              text={t("common.confirm", "Confirm")}
            />
          </div>
        )}

        {method === "password" && (
          <form onSubmit={handleVerifyPassword} className="py-2 space-y-4">
            <FormGroup label={t("account.currentPassword", "Current Password")}>
              <InputGroup
                leftIcon="lock"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                rightElement={
                  <Button
                    minimal
                    icon={showPassword ? "eye-open" : "eye-off"}
                    onClick={() => setShowPassword(!showPassword)}
                  />
                }
              />
            </FormGroup>
            <Button
              fill
              intent={Intent.PRIMARY}
              type="submit"
              loading={loading}
              text={t("common.confirm", "Confirm")}
            />
          </form>
        )}
      </div>
    </Dialog>
  );
};
