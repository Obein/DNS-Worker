import React, { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  FormGroup,
  InputGroup,
  Dialog,
  Callout,
  Intent,
  Classes,
  Divider
} from "@blueprintjs/core";
import { hashPasswordClient, hashPin, hashTotpToken } from "../../../utils/auth";
import { setPin, ApiError } from "../../../services";
import type { UserInfo } from "../../../services";
import { DigitInput, type DigitInputRef } from "../../../components/DigitInput";

interface SetupPinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserInfo | null;
  onSuccess: () => void;
}

export const SetupPinDialog: React.FC<SetupPinDialogProps> = ({
  isOpen,
  onClose,
  user,
  onSuccess
}) => {
  const { t } = useTranslation();
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [verifyTotp, setVerifyTotp] = useState("");
  const [useTotpForVerify, setUseTotpForVerify] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const confirmPinRef = useRef<DigitInputRef>(null);
  const totpRef = useRef<DigitInputRef>(null);

  const handleSetupPin = async (e?: React.FormEvent, totpValue?: string) => {
    if (e) e.preventDefault();
    if (newPin.length !== 4 || !/^\d{4}$/.test(newPin)) {
      setError(t("auth.pinFormatTip", "PIN must be exactly 4 digits"));
      return;
    }
    if (newPin !== confirmPin) {
      setError(t("auth.pinMatchTip", "PINs do not match"));
      return;
    }

    setLoading(true);
    setError("");

    try {
      const pinHashValue = await hashPin(newPin, user?.id || "");
      
      const verificationPayload: { password?: string; totpTokenHash?: string; totpSalt?: string } = {};
      if (user?.totp_enabled && useTotpForVerify) {
        const salt = crypto.randomUUID();
        const finalTotp = totpValue || verifyTotp;
        const hashHex = await hashTotpToken(finalTotp.replace(/\s/g, ""), salt);
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

      await setPin(pinHashValue, verificationPayload);

      setNewPin("");
      setConfirmPin("");
      setVerifyPassword("");
      setVerifyTotp("");
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.bodyText);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("common.errorNetwork"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    setNewPin("");
    setConfirmPin("");
    setVerifyPassword("");
    setVerifyTotp("");
    onClose();
  };

  const isPinEnabled = !!user?.pin_enabled;

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={isPinEnabled ? t("auth.changePin", "Change PIN") : t("auth.configurePin", "Configure PIN")}
      icon="key"
      className="pb-0"
      style={{ width: "400px" }}
    >
      <form onSubmit={handleSetupPin}>
        <div className={Classes.DIALOG_BODY}>
          {error && (
            <Callout intent={Intent.DANGER} className="mb-4">
              {error}
            </Callout>
          )}

          <FormGroup 
            label={t("auth.newPin", "New 4-Digit PIN")} 
            labelFor="new-pin-input"
            helperText={t("auth.pinHelper", "Digits only, e.g., 1234")}
          >
            <DigitInput
              length={4}
              value={newPin}
              onChange={setNewPin}
              type="password"
              disabled={loading}
              autoFocus
              onComplete={() => confirmPinRef.current?.focus()}
            />
          </FormGroup>

          <FormGroup label={t("auth.confirmPin", "Confirm New PIN")} labelFor="confirm-pin-input">
            <DigitInput
              ref={confirmPinRef}
              length={4}
              value={confirmPin}
              onChange={setConfirmPin}
              type="password"
              disabled={loading}
              onComplete={() => {
                if (user?.totp_enabled && useTotpForVerify) {
                  totpRef.current?.focus();
                } else {
                  document.getElementById("verify-pw-input")?.focus();
                }
              }}
            />
          </FormGroup>

          <Divider className="my-4" />

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
            <FormGroup label={t("auth.totpCode", "2FA Code")} labelFor="verify-totp-input">
              <DigitInput
                ref={totpRef}
                length={6}
                value={verifyTotp}
                onChange={setVerifyTotp}
                disabled={loading}
                onComplete={(val) => handleSetupPin(undefined, val)}
                autoFocus
              />
            </FormGroup>
          ) : (
            <FormGroup label={t("auth.currentPassword", "Current Password")} labelFor="verify-pw-input">
              <InputGroup
                id="verify-pw-input"
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
            <Button type="submit" intent={Intent.PRIMARY} loading={loading}>
              {t("common.save", "Save")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};
