import React, { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Button,
  ButtonGroup,
  FormGroup,
  InputGroup,
  Dialog,
  Callout,
  Intent,
  Classes,
  Divider
} from "@blueprintjs/core";
import { Lock, Key, ShieldCheck } from "lucide-react";
import { hashPasswordClient, hashPin, hashTotpToken, PIN_REGEX, formatApiErrorMessage } from "../../../utils/auth";
import { setPin, getPasskeyAuthOptions, type VerifyIdentityPayload } from "../../../services/account";
import type { UserInfo } from "../../../services";
import { DigitInput, type DigitInputRef } from "../../../components/DigitInput";
import { startPasskeyAuthentication } from "../../../utils/webauthn";

export type PinAuthMethod = "password" | "passkey" | "totp";

export interface SetupPinDialogProps {
  isOpen: boolean;
  onClose: () => void;
  user: UserInfo | null;
  onSuccess: () => void;
}

/**
 * SetupPinDialog handles configuring or changing the 4-digit PIN code for session locking.
 * Supports verifying identity via Current Password, Passkey, or Authenticator App (TOTP).
 */
export const SetupPinDialog: React.FC<SetupPinDialogProps> = ({
  isOpen,
  onClose,
  user,
  onSuccess
}) => {
  const { t } = useTranslation();

  const hasPasskey = !!(user?.passkeys_count && user.passkeys_count > 0);
  const hasTotp = !!user?.totp_enabled;

  const [authMethod, setAuthMethod] = useState<PinAuthMethod>("password");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [verifyPassword, setVerifyPassword] = useState("");
  const [showVerifyPassword, setShowVerifyPassword] = useState(false);
  const [verifyTotp, setVerifyTotp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const confirmPinRef = useRef<DigitInputRef>(null);
  const totpRef = useRef<DigitInputRef>(null);

  // Sync valid method if user capabilities change
  useEffect(() => {
    if (authMethod === "passkey" && !hasPasskey) {
      setAuthMethod(hasTotp ? "totp" : "password");
    } else if (authMethod === "totp" && !hasTotp) {
      setAuthMethod(hasPasskey ? "passkey" : "password");
    }
  }, [hasPasskey, hasTotp, authMethod]);

  const handleSetupPin = async (e?: React.FormEvent, totpValue?: string) => {
    if (e) e.preventDefault();
    if (newPin.length !== 4 || !PIN_REGEX.test(newPin)) {
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
      const userId = user?.id || sessionStorage.getItem("dns_worker_user_id");
      if (!userId) {
        setError(t("auth.sessionExpired", "Session expired. Logging out..."));
        setTimeout(() => {
          handleClose();
        }, 1500);
        return;
      }
      const pinHashValue = await hashPin(newPin, userId);

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

      await setPin(pinHashValue, verificationPayload);

      setNewPin("");
      setConfirmPin("");
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
    setNewPin("");
    setConfirmPin("");
    setVerifyPassword("");
    setShowVerifyPassword(false);
    setVerifyTotp("");
    setAuthMethod("password");
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
      style={{ width: "420px" }}
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
                if (authMethod === "totp") {
                  totpRef.current?.focus();
                } else if (authMethod === "password") {
                  document.getElementById("verify-pw-input")?.focus();
                }
              }}
            />
          </FormGroup>

          <Divider className="my-4" />

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
            <FormGroup label={t("auth.currentPassword", "Current Password")} labelFor="verify-pw-input">
              <InputGroup
                id="verify-pw-input"
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
            <FormGroup label={t("auth.totpCode", "TOTP Code")} labelFor="verify-totp-input">
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
            <Button type="submit" intent={Intent.PRIMARY} loading={loading}>
              {t("common.save", "Save")}
            </Button>
          </div>
        </div>
      </form>
    </Dialog>
  );
};
