import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  FormGroup,
  InputGroup,
  Dialog,
  Callout,
  Intent,
  Classes
} from "@blueprintjs/core";
import { ShieldAlert } from "lucide-react";
import { hashPasswordClient, hashTotpToken } from "../../../utils/auth";
import { clearPin } from "../../../services";
import type { UserInfo } from "../../../services";
import { DigitInput } from "../../../components/DigitInput";

interface DisablePinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserInfo | null;
  onSuccess: () => void;
}

export const DisablePinDialog: React.FC<DisablePinDialogProps> = ({
  isOpen,
  onClose,
  user,
  onSuccess
}) => {
  const { t } = useTranslation();
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyTotp, setVerifyTotp] = useState("");
  const [useTotpForVerify, setUseTotpForVerify] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleClearPin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const verificationPayload: { password?: string; totpTokenHash?: string; totpSalt?: string } = {};
      if (user?.totp_enabled && useTotpForVerify) {
        const salt = crypto.randomUUID();
        const hashHex = await hashTotpToken(verifyTotp.replace(/\s/g, ""), salt);
        verificationPayload.totpTokenHash = hashHex;
        verificationPayload.totpSalt = salt;
      } else {
        if (!verifyPassword) {
          setError(t("auth.passwordRequired", "Password is required for verification"));
          setLoading(false);
          return;
        }
        let passwordPayload = verifyPassword;
        if (user?.password_version === 2) {
          passwordPayload = await hashPasswordClient(verifyPassword, user.username);
        }
        verificationPayload.password = passwordPayload;
      }

      await clearPin(verificationPayload);

      setVerifyPassword("");
      setVerifyTotp("");
      onSuccess();
    } catch (err: any) {
      setError(err.bodyText || err.message || t("common.errorNetwork"));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    setVerifyPassword("");
    setVerifyTotp("");
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t("auth.disablePin", "Disable Session Lock")}
      icon="trash"
      className="pb-0"
      style={{ width: "400px" }}
    >
      <form onSubmit={handleClearPin}>
        <div className={Classes.DIALOG_BODY}>
          {error && (
            <Callout intent={Intent.DANGER} className="mb-4">
              {error}
            </Callout>
          )}

          <Callout intent={Intent.WARNING} className="mb-4" icon={<ShieldAlert size={20} />}>
            {t("auth.disablePinWarning", "Disabling the PIN will disable the inactivity session locking feature completely.")}
          </Callout>

          <div className="flex justify-between items-center mb-2">
            <span className="font-semibold text-sm">{t("auth.verifyIdentity", "Verify Identity")}</span>
            {user?.totp_enabled && (
              <Button
                minimal
                small
                intent={Intent.PRIMARY}
                onClick={() => setUseTotpForVerify(!useTotpForVerify)}
              >
                {useTotpForVerify ? t("auth.usePassword", "Use Password") : t("auth.use2fa", "Use 2FA Code")}
              </Button>
            )}
          </div>

          {user?.totp_enabled && useTotpForVerify ? (
            <FormGroup label={t("auth.totpCode", "2FA Code")} labelFor="disable-totp-input">
              <DigitInput
                length={6}
                value={verifyTotp}
                onChange={setVerifyTotp}
                disabled={loading}
                onComplete={() => handleClearPin()}
              />
            </FormGroup>
          ) : (
            <FormGroup label={t("auth.currentPassword", "Current Password")} labelFor="disable-pw-input">
              <InputGroup
                id="disable-pw-input"
                type="password"
                placeholder={t("auth.passwordPlaceholder", "Enter current password")}
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                leftIcon="lock"
                required
              />
            </FormGroup>
          )}
        </div>

        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={handleClose}>{t("common.cancel", "Cancel")}</Button>
            <Button type="submit" intent={Intent.DANGER} loading={loading}>
              {t("common.disable", "Disable")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};
