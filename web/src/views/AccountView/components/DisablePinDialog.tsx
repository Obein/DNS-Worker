import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ButtonGroup,
  FormGroup,
  InputGroup,
  Dialog,
  Callout,
  Intent,
  Classes
} from "@blueprintjs/core";
import { ShieldAlert, Lock, Key, ShieldCheck } from "lucide-react";
import { hashPasswordClient, hashTotpToken, formatApiErrorMessage } from "../../../utils/auth";
import { clearPin, getPasskeyAuthOptions, type VerifyIdentityPayload } from "../../../services/account";
import type { UserInfo } from "../../../services";
import { DigitInput } from "../../../components/DigitInput";
import { startPasskeyAuthentication } from "../../../utils/webauthn";
import type { PinAuthMethod } from "./SetupPinDialog";

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

  const hasPasskey = !!(user?.passkeys_count && user.passkeys_count > 0);
  const hasTotp = !!user?.totp_enabled;

  const [authMethod, setAuthMethod] = useState<PinAuthMethod>("password");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [showVerifyPassword, setShowVerifyPassword] = useState(false);
  const [verifyTotp, setVerifyTotp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Sync valid method if user capabilities change
  useEffect(() => {
    if (authMethod === "passkey" && !hasPasskey) {
      setAuthMethod(hasTotp ? "totp" : "password");
    } else if (authMethod === "totp" && !hasTotp) {
      setAuthMethod(hasPasskey ? "passkey" : "password");
    }
  }, [hasPasskey, hasTotp, authMethod]);

  const handleClearPin = async (e?: React.FormEvent, totpValue?: string) => {
    if (e) e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const verificationPayload: VerifyIdentityPayload = {};

      if (authMethod === "passkey") {
        const options = await getPasskeyAuthOptions();
        const passkeyAssertion = await startPasskeyAuthentication(options);
        verificationPayload.passkeyAssertion = passkeyAssertion;
      } else if (authMethod === "totp") {
        const finalTotp = (totpValue || verifyTotp).replace(/\s/g, "");
        if (finalTotp.length !== 6) {
          setError(t("account.totp.invalidCode", "Please enter a 6-digit code"));
          setLoading(false);
          return;
        }
        const salt = crypto.randomUUID();
        const hashHex = await hashTotpToken(finalTotp, salt);
        verificationPayload.totpTokenHash = hashHex;
        verificationPayload.totpSalt = salt;
      } else {
        if (!verifyPassword) {
          setError(t("auth.passwordRequired", "Password is required for verification"));
          setLoading(false);
          return;
        }
        let passwordPayload = verifyPassword;
        if (user?.password_version === 2 && user?.username) {
          passwordPayload = await hashPasswordClient(verifyPassword, user.username);
        }
        verificationPayload.password = passwordPayload;
      }

      await clearPin(verificationPayload);

      setVerifyPassword("");
      setVerifyTotp("");
      onSuccess();
    } catch (err) {
      setError(formatApiErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError("");
    setVerifyPassword("");
    setShowVerifyPassword(false);
    setVerifyTotp("");
    setAuthMethod("password");
    onClose();
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={handleClose}
      title={t("auth.disablePin", "Disable Session Lock")}
      icon="trash"
      className="pb-0"
      style={{ width: "420px" }}
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

          <div className="flex justify-between items-center mb-3">
            <span className="font-semibold text-sm">{t("auth.verifyIdentity", "Verify Identity")}</span>
            {(hasPasskey || hasTotp) && (
              <div className="flex items-center isolate" style={{ isolation: "isolate" }}>
                <ButtonGroup variant="minimal" style={{ isolation: "isolate" }}>
                  <Button
                    small
                    active={authMethod === "password"}
                    intent={authMethod === "password" ? Intent.PRIMARY : Intent.NONE}
                    icon={<Lock size={14} />}
                    text={t("account.mfa.password", "Password")}
                    onClick={() => {
                      setAuthMethod("password");
                      setError("");
                    }}
                  />
                  {hasPasskey && (
                    <Button
                      small
                      active={authMethod === "passkey"}
                      intent={authMethod === "passkey" ? Intent.PRIMARY : Intent.NONE}
                      icon={<Key size={14} />}
                      text={t("account.mfa.passkey", "Passkey")}
                      onClick={() => {
                        setAuthMethod("passkey");
                        setError("");
                      }}
                    />
                  )}
                  {hasTotp && (
                    <Button
                      small
                      active={authMethod === "totp"}
                      intent={authMethod === "totp" ? Intent.PRIMARY : Intent.NONE}
                      icon={<ShieldCheck size={14} />}
                      text={t("account.mfa.totp", "TOTP")}
                      onClick={() => {
                        setAuthMethod("totp");
                        setError("");
                      }}
                    />
                  )}
                </ButtonGroup>
              </div>
            )}
          </div>

          {authMethod === "password" && (
            <FormGroup label={t("auth.currentPassword", "Current Password")} labelFor="disable-pw-input">
              <InputGroup
                id="disable-pw-input"
                type={showVerifyPassword ? "text" : "password"}
                placeholder={t("auth.passwordPlaceholder", "Enter current password")}
                value={verifyPassword}
                onChange={(e) => setVerifyPassword(e.target.value)}
                leftIcon="lock"
                rightElement={
                  <Button
                    minimal={true}
                    icon={showVerifyPassword ? "eye-open" : "eye-off"}
                    onClick={() => setShowVerifyPassword(!showVerifyPassword)}
                    title={showVerifyPassword ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
                  />
                }
                required
              />
            </FormGroup>
          )}

          {authMethod === "totp" && (
            <FormGroup label={t("auth.totpCode", "TOTP Code")} labelFor="disable-totp-input">
              <DigitInput
                length={6}
                value={verifyTotp}
                onChange={setVerifyTotp}
                disabled={loading}
                onComplete={(val) => handleClearPin(undefined, val)}
                autoFocus
              />
            </FormGroup>
          )}

          {authMethod === "passkey" && (
            <Callout intent={Intent.PRIMARY} icon={<Key size={16} />}>
              <span className="text-xs">
                {t(
                  "account.passkey.submitNotice",
                  t("account.passkey.changePwNotice", "You will be prompted to verify via biometric authentication or your security key when submitting.")
                )}
              </span>
            </Callout>
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
