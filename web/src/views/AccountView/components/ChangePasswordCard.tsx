import React from "react";
import {
  Card,
  Elevation,
  H4,
  Button,
  FormGroup,
  InputGroup,
  Tooltip,
  Position,
  Intent,
  Callout
} from "@blueprintjs/core";
import { Key, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";

/**
 * Properties for the ChangePasswordCard component.
 */
export interface ChangePasswordCardProps {
  /** The current user information object. */
  me: UserInfo | null;
  /** Flag showing if TOTP verification is used instead of old password. */
  useTotpForPw: boolean;
  /** Callback to toggle between old password and TOTP mode. */
  setUseTotpForPw: (useTotp: boolean) => void;
  /** The 6-digit TOTP verification token input value. */
  totpToken: string;
  /** Callback to update the TOTP token value. */
  setTotpToken: (token: string) => void;
  /** The old password input value. */
  oldPassword: string;
  /** Callback to update the old password value. */
  setOldPassword: (pw: string) => void;
  /** The new password input value. */
  newPassword: string;
  /** Callback to update the new password value. */
  setNewPassword: (pw: string) => void;
  /** State indicating if new password input field has focus. */
  newPasswordFocused: boolean;
  /** Callback to update new password input focus state. */
  setNewPasswordFocused: (focused: boolean) => void;
  /** Indicates if update request is loading. */
  pwLoading: boolean;
  /** Notification message container from update response. */
  pwMessage: { text: string; intent: Intent } | null;
  /** Callback to clear password message. */
  onClearMessage: () => void;
  /** Callback to handle the form submission. */
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * ChangePasswordCard component renders the password change form.
 *
 * @param props - Component props.
 * @returns React element representing change password card.
 */
export const ChangePasswordCard: React.FC<ChangePasswordCardProps> = ({
  me,
  useTotpForPw,
  setUseTotpForPw,
  totpToken,
  setTotpToken,
  oldPassword,
  setOldPassword,
  newPassword,
  setNewPassword,
  newPasswordFocused,
  setNewPasswordFocused,
  pwLoading,
  pwMessage,
  onClearMessage,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Key size={20} className="text-orange-500" />
          <H4 style={{ margin: 0 }}>{t("account.changePassword")}</H4>
        </div>
        {me?.totp_enabled && (
          <Button
            minimal
            small
            icon={
              <ShieldCheck
                size={14}
                className={useTotpForPw ? "text-blue-500" : "text-gray-400"}
              />
            }
            text={
              useTotpForPw
                ? t("account.totp.usePasswordInstead", "Use Password Instead")
                : t("account.totp.useTotpInstead", "Use TOTP Instead")
            }
            onClick={() => {
              setUseTotpForPw(!useTotpForPw);
              onClearMessage();
              setOldPassword("");
              setTotpToken("");
            }}
          />
        )}
      </div>
      {pwMessage && (
        <Callout intent={pwMessage.intent} className="mb-4">
          {pwMessage.text}
        </Callout>
      )}
      <form onSubmit={onSubmit} className="space-y-4">
        {useTotpForPw ? (
          <FormGroup label={t("account.totpCode", "Authenticator Code")}>
            <InputGroup
              leftIcon="shield"
              placeholder="000000"
              value={totpToken}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              maxLength={6}
              inputMode="numeric"
              required
            />
          </FormGroup>
        ) : (
          <FormGroup label={t("account.currentPassword")}>
            <InputGroup
              leftIcon="lock"
              type="password"
              value={oldPassword}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setOldPassword(e.target.value)
              }
              required
            />
          </FormGroup>
        )}
        <FormGroup label={t("account.newPassword")}>
          <Tooltip
            content={t("account.formatTipPassword")}
            isOpen={newPasswordFocused}
            position={Position.TOP}
            intent={Intent.PRIMARY}
            className="w-full"
          >
            <div className="w-full block">
              <InputGroup
                leftIcon="lock"
                type="password"
                value={newPassword}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setNewPassword(e.target.value)
                }
                onFocus={() => setNewPasswordFocused(true)}
                onBlur={() => setNewPasswordFocused(false)}
                required
              />
            </div>
          </Tooltip>
        </FormGroup>
        <Button
          fill
          intent={Intent.WARNING}
          type="submit"
          loading={pwLoading}
          text={t("account.updatePassword")}
        />
      </form>
    </Card>
  );
};
