import React, { useState, useEffect } from "react";
import {
  Dialog,
  Button,
  Intent,
  Callout,
  FormGroup,
  InputGroup
} from "@blueprintjs/core";
import { KeyRound, CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { testTotp } from "../../../../services";

export interface TestTotpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Modal dialog for verifying that the user's configured authenticator app
 * is working properly and generating valid 6-digit TOTP codes.
 */
export const TestTotpDialog: React.FC<TestTotpDialogProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useTranslation();
  const [token, setToken] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [success, setSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      setToken("");
      setError("");
      setSuccess(false);
      setLoading(false);
    }
  }, [isOpen]);

  const handleTest = async (codeToTest?: string): Promise<void> => {
    const code = (codeToTest ?? token).trim().replace(/\s/g, "");
    if (code.length !== 6) {
      setError(t("account.totp.invalidCode", "Please enter a 6-digit code"));
      return;
    }
    setLoading(true);
    setError("");
    setSuccess(false);
    try {
      await testTotp(code);
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || t("account.totp.testFailed", "Invalid verification code"));
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const val = e.target.value.replace(/\D/g, "").slice(0, 6);
    setToken(val);
    setError("");
    setSuccess(false);
    if (val.length === 6) {
      handleTest(val);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t("account.totp.testTitle", "Test Authenticator App (TOTP)")}
      icon={<KeyRound size={18} />}
    >
      <div className="p-6 space-y-4">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {t(
            "account.totp.testDesc",
            "Enter the 6-digit verification code from your authenticator app to verify that it is generating valid codes."
          )}
        </p>

        {success && (
          <Callout intent={Intent.SUCCESS} icon={<CheckCircle2 size={16} />}>
            {t(
              "account.totp.testSuccess",
              "Verification successful! Your authenticator app is configured properly."
            )}
          </Callout>
        )}

        {error && (
          <Callout intent={Intent.DANGER}>
            {error}
          </Callout>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTest();
          }}
          className="space-y-4"
        >
          <FormGroup
            label={t("account.totp.verificationCode", "6-Digit Verification Code")}
            labelFor="test-totp-input"
          >
            <InputGroup
              id="test-totp-input"
              value={token}
              onChange={handleChange}
              placeholder="123456"
              maxLength={6}
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              className="font-mono text-lg tracking-widest"
              disabled={loading}
            />
          </FormGroup>

          <div className="flex justify-end gap-2">
            <Button
              text={success ? t("common.close", "Close") : t("common.cancel", "Cancel")}
              onClick={onClose}
            />
            {!success && (
              <Button
                intent={Intent.PRIMARY}
                text={t("account.totp.verifyBtn", "Verify")}
                type="submit"
                loading={loading}
                disabled={token.length !== 6}
              />
            )}
          </div>
        </form>
      </div>
    </Dialog>
  );
};
