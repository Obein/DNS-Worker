import React, { useState, useEffect } from "react";
import {
  Dialog,
  Intent,
  Callout,
  Classes
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { hashPasswordClient, formatApiErrorMessage } from "../../../utils/auth";
import { getPasskeyAuthOptions, type VerifyIdentityPayload } from "../../../services/account";
import { startPasskeyAuthentication } from "../../../utils/webauthn";
import type { UserInfo } from "../types";
import { MethodSelector, type AuthMethod } from "./verify/MethodSelector";
import { PasskeyVerifyForm } from "./verify/forms/PasskeyVerifyForm";
import { TotpVerifyForm } from "./verify/forms/TotpVerifyForm";
import { PasswordVerifyForm } from "./verify/forms/PasswordVerifyForm";
import { RecoveryKeyVerifyForm } from "./verify/forms/RecoveryKeyVerifyForm";

export type { AuthMethod };

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
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [totpCode, setTotpCode] = useState<string>("");
  const [recoveryKey, setRecoveryKey] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Synchronously reset and synchronize state during render when dialog opens
  const [prevIsOpen, setPrevIsOpen] = useState<boolean>(isOpen);
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

  const handleVerifyPassword = async (e?: React.FormEvent): Promise<void> => {
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
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPasskey = async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      const options = await getPasskeyAuthOptions();
      const passkeyAssertion = await startPasskeyAuthentication(options);
      await onVerify({ passkeyAssertion });
      onClose();
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyTotp = async (codeValue?: string): Promise<void> => {
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
    } catch (err: unknown) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRecoveryKey = async (e?: React.FormEvent): Promise<void> => {
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
    } catch (err: unknown) {
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

        {methodCount > 1 && (
          <MethodSelector
            method={method}
            onSelectMethod={(m) => {
              setMethod(m);
              setError("");
            }}
            hasPasskey={hasPasskey}
            hasRecoveryKey={hasRecoveryKey}
            hasTotp={hasTotp}
            hasPassword={hasPassword}
          />
        )}

        {error && (
          <Callout intent={Intent.DANGER} className="mb-4">
            {error}
          </Callout>
        )}

        {method === "recovery_key" && (
          <RecoveryKeyVerifyForm
            recoveryKey={recoveryKey}
            setRecoveryKey={setRecoveryKey}
            loading={loading}
            onSubmit={handleVerifyRecoveryKey}
          />
        )}

        {method === "passkey" && (
          <PasskeyVerifyForm
            loading={loading}
            onVerify={handleVerifyPasskey}
          />
        )}

        {method === "totp" && (
          <TotpVerifyForm
            totpCode={totpCode}
            setTotpCode={setTotpCode}
            loading={loading}
            onVerify={handleVerifyTotp}
          />
        )}

        {method === "password" && (
          <PasswordVerifyForm
            password={password}
            setPassword={setPassword}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            loading={loading}
            onSubmit={handleVerifyPassword}
          />
        )}
      </div>
    </Dialog>
  );
};
