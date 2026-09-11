import React, { useState, useEffect } from "react";
import {
  Card,
  Elevation,
  H4,
  Button,
  ButtonGroup,
  FormGroup,
  InputGroup,
  Tooltip,
  Position,
  Intent,
  Callout
} from "@blueprintjs/core";
import { Key, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DigitInput } from "../../../components/DigitInput";
import type { UserInfo } from "../types";
import { PASSWORD_REGEX, hashPasswordClient, formatApiErrorMessage } from "../../../utils/auth";
import { updatePassword, getPasskeyAuthOptions } from "../../../services/account";
import { startPasskeyAuthentication } from "../../../utils/webauthn";

export type PwAuthMethod = "password" | "passkey" | "totp";

export interface ChangePasswordCardProps {
  me: UserInfo | null;
  onRefresh?: () => void;
}

export const ChangePasswordCard: React.FC<ChangePasswordCardProps> = ({ me, onRefresh }) => {
  const { t } = useTranslation();

  const hasPasskey = !!(me?.passkeys_count && me.passkeys_count > 0);
  const hasTotp = !!me?.totp_enabled;

  const [authMethod, setAuthMethod] = useState<PwAuthMethod>("password");
  const [oldPassword, setOldPassword] = useState("");
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [totpToken, setTotpToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newPasswordFocused, setNewPasswordFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; intent: Intent } | null>(null);

  useEffect(() => {
    if (authMethod === "passkey" && !hasPasskey) {
      setAuthMethod(hasTotp ? "totp" : "password");
    } else if (authMethod === "totp" && !hasTotp) {
      setAuthMethod(hasPasskey ? "passkey" : "password");
    }
  }, [hasPasskey, hasTotp, authMethod]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!PASSWORD_REGEX.test(newPassword)) {
      setMessage({
        text: t("account.formatTipPassword", "Password must be 12-100 characters and contain letters, numbers, and symbols."),
        intent: Intent.DANGER
      });
      return;
    }

    if (!me?.username) {
      setMessage({
        text: t("auth.sessionExpired", "Session expired. Please log in again."),
        intent: Intent.DANGER
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const newPasswordPayload = await hashPasswordClient(newPassword, me.username);

      if (authMethod === "passkey") {
        const options = await getPasskeyAuthOptions();
        const passkeyAssertion = await startPasskeyAuthentication(options);
        await updatePassword({
          passkeyAssertion,
          newPassword: newPasswordPayload
        });
      } else if (authMethod === "totp") {
        if (totpToken.length !== 6) {
          setMessage({
            text: t("account.totp.invalidCode", "Please enter a 6-digit code"),
            intent: Intent.DANGER
          });
          setLoading(false);
          return;
        }
        const salt = crypto.randomUUID();
        const msgBuffer = new TextEncoder().encode(totpToken + salt);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
        const totpTokenHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        await updatePassword({
          totpTokenHash,
          totpSalt: salt,
          newPassword: newPasswordPayload
        });
      } else {
        if (!oldPassword) {
          setMessage({
            text: t("auth.passwordRequired", "Current password is required"),
            intent: Intent.DANGER
          });
          setLoading(false);
          return;
        }
        let oldPasswordPayload = oldPassword;
        if ((me.password_version ?? 1) === 2) {
          oldPasswordPayload = await hashPasswordClient(oldPassword, me.username);
        }
        await updatePassword({
          oldPassword: oldPasswordPayload,
          newPassword: newPasswordPayload
        });
      }

      setMessage({
        text: t("account.passwordSuccess", "Password updated successfully!"),
        intent: Intent.SUCCESS
      });
      setOldPassword("");
      setTotpToken("");
      setNewPassword("");
      if (onRefresh) onRefresh();
    } catch (err: any) {
      setMessage({
        text: formatApiErrorMessage(err, t),
        intent: Intent.DANGER
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Key size={20} className="text-orange-500" />
          <H4 style={{ margin: 0 }}>{t("account.changePassword", "Change Password")}</H4>
        </div>

        {(hasPasskey || hasTotp) && (
          <div className="flex items-center">
            <ButtonGroup>
              <Button
                small
                active={authMethod === "password"}
                intent={authMethod === "password" ? Intent.PRIMARY : Intent.NONE}
                icon={<Lock size={12} />}
                text={t("account.mfa.password", "Password")}
                onClick={() => {
                  setAuthMethod("password");
                  setMessage(null);
                }}
              />
              {hasPasskey && (
                <Button
                  small
                  active={authMethod === "passkey"}
                  intent={authMethod === "passkey" ? Intent.PRIMARY : Intent.NONE}
                  icon={<Key size={12} />}
                  text={t("account.mfa.passkey", "Passkey")}
                  onClick={() => {
                    setAuthMethod("passkey");
                    setMessage(null);
                  }}
                />
              )}
              {hasTotp && (
                <Button
                  small
                  active={authMethod === "totp"}
                  intent={authMethod === "totp" ? Intent.PRIMARY : Intent.NONE}
                  icon={<ShieldCheck size={12} />}
                  text={t("account.mfa.totp", "TOTP")}
                  onClick={() => {
                    setAuthMethod("totp");
                    setMessage(null);
                  }}
                />
              )}
            </ButtonGroup>
          </div>
        )}
      </div>

      {message && (
        <Callout intent={message.intent} className="mb-4">
          {message.text}
        </Callout>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {authMethod === "password" && (
          <FormGroup label={t("account.currentPassword", "Current Password")}>
            <InputGroup
              leftIcon="lock"
              type={showOldPassword ? "text" : "password"}
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              rightElement={
                <Button
                  minimal
                  icon={showOldPassword ? "eye-open" : "eye-off"}
                  onClick={() => setShowOldPassword(!showOldPassword)}
                  title={showOldPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                />
              }
              required
            />
          </FormGroup>
        )}

        {authMethod === "totp" && (
          <FormGroup label={t("account.totpCode", "Authenticator Code")}>
            <DigitInput
              length={6}
              value={totpToken}
              onChange={setTotpToken}
              disabled={loading}
            />
          </FormGroup>
        )}

        {authMethod === "passkey" && (
          <Callout intent={Intent.PRIMARY} icon={<Key size={16} />}>
            <span className="text-xs">
              {t(
                "account.passkey.changePwNotice",
                "You will be prompted to verify via biometric authentication or your security key when submitting."
              )}
            </span>
          </Callout>
        )}

        <FormGroup label={t("account.newPassword", "New Password")}>
          <Tooltip
            content={t("account.formatTipPassword", "Password must be 12-100 characters and contain letters, numbers, and symbols.")}
            isOpen={newPasswordFocused}
            position={Position.TOP}
            intent={Intent.PRIMARY}
            className="w-full"
          >
            <div className="w-full block">
              <InputGroup
                leftIcon="lock"
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                onFocus={() => setNewPasswordFocused(true)}
                onBlur={() => setNewPasswordFocused(false)}
                rightElement={
                  <Button
                    minimal
                    icon={showNewPassword ? "eye-open" : "eye-off"}
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    title={showNewPassword ? t("auth.hidePassword") : t("auth.showPassword")}
                  />
                }
                required
              />
            </div>
          </Tooltip>
        </FormGroup>

        <Button
          fill
          intent={authMethod === "passkey" ? Intent.PRIMARY : Intent.WARNING}
          type="submit"
          loading={loading}
          icon={authMethod === "passkey" ? <Key size={16} /> : undefined}
          text={
            authMethod === "passkey"
              ? t("account.changePasswordWithPasskey", "Verify with Passkey & Update")
              : t("account.updatePassword", "Update Password")
          }
        />
      </form>
    </Card>
  );
};
