import React from "react";
import {
  Card,
  Elevation,
  H4,
  Tag,
  Intent,
  Switch,
  Divider,
  Button,
  Dialog,
  Callout,
  FormGroup,
  InputGroup
} from "@blueprintjs/core";
import { Shield, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../../types";

/**
 * Properties for the TOTPEnabledState component.
 */
export interface TOTPEnabledStateProps {
  /** The current user information object. */
  user: UserInfo;
  /** Flag indicating if updating settings request is loading. */
  settingsLoading: boolean;
  /** Callback triggered when the skip password switch changes. */
  onToggleSkipPassword: (val: boolean) => void;
  /** Flag representing if the disable 2FA dialog is open. */
  disableDialogOpen: boolean;
  /** Callback to open/close the disable 2FA dialog. */
  setDisableDialogOpen: (open: boolean) => void;
  /** Current password entered to disable 2FA. */
  disablePassword: string;
  /** Callback to update the password input field. */
  setDisablePassword: (pw: string) => void;
  /** Any disable error message from the backend. */
  disableError: string;
  /** Callback to set or reset disable error messages. */
  setDisableError: (err: string) => void;
  /** Flag representing if the disable request is loading. */
  disableLoading: boolean;
  /** Callback triggered when submitting the disable form. */
  onDisable: (e: React.SyntheticEvent) => void;
}

/**
 * TOTPEnabledState component renders the 2FA settings when 2FA is active.
 *
 * @param props - Component props.
 * @returns React element representing enabled 2FA state.
 */
export const TOTPEnabledState: React.FC<TOTPEnabledStateProps> = ({
  user,
  settingsLoading,
  onToggleSkipPassword,
  disableDialogOpen,
  setDisableDialogOpen,
  disablePassword,
  setDisablePassword,
  disableError,
  setDisableError,
  disableLoading,
  onDisable
}) => {
  const { t } = useTranslation();
  const [showDisablePassword, setShowDisablePassword] = React.useState(false);

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center gap-2 mb-4">
        <Shield size={20} className="text-green-500" />
        <H4 style={{ margin: 0 }}>
          {t("account.totp.title", "Two-Factor Authentication")}
        </H4>
        <Tag intent={Intent.SUCCESS} minimal round>
          {t("account.totp.enabled", "Enabled")}
        </Tag>
      </div>
      <div className="space-y-4">
        <Switch
          label={t(
            "account.totp.skipPassword",
            "Passwordless login (TOTP only — hide password field)"
          )}
          checked={!!user.totp_skip_password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            onToggleSkipPassword(e.currentTarget.checked)
          }
          disabled={settingsLoading}
        />
        <Divider />
        <Button
          intent={Intent.DANGER}
          outlined
          icon={<ShieldOff size={14} />}
          text={t("account.totp.disable", "Disable Two-Factor Authentication")}
          onClick={() => setDisableDialogOpen(true)}
        />
      </div>

      <Dialog
        isOpen={disableDialogOpen}
        onClose={() => {
          setDisableDialogOpen(false);
          setDisablePassword("");
          setDisableError("");
          setShowDisablePassword(false);
        }}
        title={t("account.totp.disableTitle", "Disable 2FA")}
        icon="shield"
      >
        <div className="p-6 space-y-4">
          <Callout intent={Intent.WARNING}>
            {t(
              "account.totp.disableWarning",
              "After disabling 2FA, your account will only be protected by password."
            )}
          </Callout>
          {disableError && (
            <Callout intent={Intent.DANGER}>{disableError}</Callout>
          )}
          {!user.totp_skip_password && (
            <form onSubmit={onDisable} className="space-y-4">
              <FormGroup label={t("account.currentPassword")}>
                <InputGroup
                  type={showDisablePassword ? "text" : "password"}
                  leftIcon="lock"
                  value={disablePassword}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setDisablePassword(e.target.value)
                  }
                  rightElement={
                    <Button
                      minimal={true}
                      icon={showDisablePassword ? "eye-open" : "eye-off"}
                      onClick={() => setShowDisablePassword(!showDisablePassword)}
                      title={showDisablePassword ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
                    />
                  }
                  required
                />
              </FormGroup>
              <div className="flex justify-end gap-2">
                <Button
                  text={t("account.cancel")}
                  onClick={() => setDisableDialogOpen(false)}
                />
                <Button
                  intent={Intent.DANGER}
                  text={t("account.totp.confirmDisable", "Disable 2FA")}
                  type="submit"
                  loading={disableLoading}
                />
              </div>
            </form>
          )}
          {user.totp_skip_password && (
            <div className="flex justify-end gap-2">
              <Button
                text={t("account.cancel")}
                onClick={() => setDisableDialogOpen(false)}
              />
              <Button
                intent={Intent.DANGER}
                text={t("account.totp.confirmDisable", "Disable 2FA")}
                loading={disableLoading}
                onClick={onDisable}
              />
            </div>
          )}
        </div>
      </Dialog>
    </Card>
  );
};
