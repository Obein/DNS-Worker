import React from "react";
import {
  H4,
  Tag,
  Intent,
  Button,
  Dialog,
  Callout,
  FormGroup,
  InputGroup
} from "@blueprintjs/core";
import { Smartphone, ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../../types";

/**
 * Properties for the TOTPEnabledState component.
 */
export interface TOTPEnabledStateProps {
  /** The current user information object. */
  user: UserInfo;
  /** Flag indicating if updating settings request is loading. */
  settingsLoading?: boolean;
  /** Callback triggered when the skip password switch changes. */
  onToggleSkipPassword?: (val: boolean) => void;
  /** Flag representing if the disable TOTP dialog is open. */
  disableDialogOpen: boolean;
  /** Callback to open/close the disable TOTP dialog. */
  setDisableDialogOpen: (open: boolean) => void;
  /** Current password entered to disable TOTP. */
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
 * TOTPEnabledState component renders the TOTP settings when TOTP is active.
 *
 * @param props - Component props.
 * @returns React element representing enabled TOTP state.
 */
export const TOTPEnabledState: React.FC<TOTPEnabledStateProps> = ({
  user,
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <Smartphone size={20} className="text-blue-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.totp.title", "Authenticator App (TOTP)")}
          </H4>
          <Tag intent={Intent.SUCCESS} minimal round>
            {t("account.totp.enabled", "Enabled")}
          </Tag>
        </div>

        <Button
          intent={Intent.DANGER}
          outlined
          icon={<ShieldOff size={14} />}
          text={t("account.totp.disable", "Disable Authenticator App (TOTP)")}
          onClick={() => setDisableDialogOpen(true)}
        />
      </div>
      <div className="space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            "account.totp.activeDesc",
            "Authenticator app (TOTP) is active and generating 6-digit verification codes for your account."
          )}
        </p>
      </div>

      <Dialog
        isOpen={disableDialogOpen}
        onClose={() => {
          setDisableDialogOpen(false);
          setDisablePassword("");
          setDisableError("");
          setShowDisablePassword(false);
        }}
        title={t("account.totp.disableTitle", "Disable Authenticator App (TOTP)")}
        icon="shield"
      >
        <div className="p-6 space-y-4">
          <Callout intent={Intent.WARNING}>
            {t(
              "account.totp.disableWarning",
              "After disabling TOTP, if no Passkeys are configured, your account will only be protected by password."
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
                  text={t("account.totp.confirmDisable", "Disable TOTP")}
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
                text={t("account.totp.confirmDisable", "Disable TOTP")}
                loading={disableLoading}
                onClick={onDisable}
              />
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
};
