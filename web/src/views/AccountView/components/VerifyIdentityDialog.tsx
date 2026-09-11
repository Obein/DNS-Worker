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
import { Key, ShieldCheck, Fingerprint } from "lucide-react";
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

export type AuthMethod = "password" | "passkey" | "totp";

export const VerifyIdentityDialog: React.FC<VerifyIdentityDialogProps> = ({
  isOpen,
  onClose,
  user,
  title,
  onVerify
}) => {
  const { t } = useTranslation();

  const hasPasskey = !!(user?.passkeys_count && user.passkeys_count > 0);
  const hasTotp = !!user?.totp_enabled;

  const [method, setMethod] = useState<AuthMethod>("password");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isOpen) {
      setError("");
      setPassword("");
      setTotpCode("");
      if (hasPasskey) {
        setMethod("passkey");
      } else if (hasTotp) {
        setMethod("totp");
      } else {
        setMethod("password");
      }
    }
  }, [isOpen, hasPasskey, hasTotp]);

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
        {(hasPasskey || hasTotp) && (
          <div className="flex justify-center mb-5">
            <ButtonGroup fill>
              {hasPasskey && (
                <Button
                  active={method === "passkey"}
                  intent={method === "passkey" ? Intent.PRIMARY : Intent.NONE}
                  icon={<Fingerprint size={14} />}
                  text={t("account.mfa.passkey", "Passkey")}
                  onClick={() => {
                    setMethod("passkey");
                    setError("");
                  }}
                />
              )}
              {hasTotp && (
                <Button
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
              <Button
                active={method === "password"}
                intent={method === "password" ? Intent.PRIMARY : Intent.NONE}
                icon={<Key size={14} />}
                text={t("account.mfa.password", "Password")}
                onClick={() => {
                  setMethod("password");
                  setError("");
                }}
              />
            </ButtonGroup>
          </div>
        )}

        {error && (
          <Callout intent={Intent.DANGER} className="mb-4">
            {error}
          </Callout>
        )}

        {method === "passkey" && (
          <div className="text-center py-4 space-y-4">
            <div className="flex justify-center">
              <div className="p-4 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-500">
                <Fingerprint size={48} />
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
              icon={<Fingerprint size={16} />}
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
