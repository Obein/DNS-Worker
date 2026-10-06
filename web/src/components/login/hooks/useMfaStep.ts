import { useState } from "react";
import { useTranslation } from "react-i18next";
import { hashTotpToken, formatApiErrorMessage } from "../../../utils/auth";
import { startPasskeyAuthentication } from "../../../utils/webauthn";
import type { LoginCredentials } from "./useLoginAuth";

export interface UseMfaStepProps {
  hasPasswordEntered: boolean;
  passkeyOptions: unknown;
  executeLogin: (credentials: LoginCredentials) => Promise<void>;
  onError: (msg: string) => void;
}

export interface UseMfaStepReturn {
  mfaMethod: "passkey" | "totp" | "recovery";
  setMfaMethod: React.Dispatch<React.SetStateAction<"passkey" | "totp" | "recovery">>;
  totpToken: string;
  setTotpToken: React.Dispatch<React.SetStateAction<string>>;
  recoveryKey: string;
  setRecoveryKey: React.Dispatch<React.SetStateAction<string>>;
  passkeyLoading: boolean;
  setPasskeyLoading: React.Dispatch<React.SetStateAction<boolean>>;
  handlePasskeyLogin: () => Promise<void>;
  handleStep3Submit: (e: React.FormEvent) => Promise<void>;
  resetMfaFields: () => void;
}

/**
 * Hook to manage Multi-Factor Authentication (Passkey, TOTP, Recovery Key) submission during login.
 */
export function useMfaStep({
  hasPasswordEntered,
  passkeyOptions,
  executeLogin,
  onError
}: UseMfaStepProps): UseMfaStepReturn {
  const [mfaMethod, setMfaMethod] = useState<"passkey" | "totp" | "recovery">("passkey");
  const [totpToken, setTotpToken] = useState<string>("");
  const [recoveryKey, setRecoveryKey] = useState<string>("");
  const [passkeyLoading, setPasskeyLoading] = useState<boolean>(false);

  const { t } = useTranslation();

  const handlePasskeyLogin = async (): Promise<void> => {
    if (!passkeyOptions) return;
    setPasskeyLoading(true);
    onError("");

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const assertion = await startPasskeyAuthentication(passkeyOptions as any);
      await executeLogin({
        useEnteredPassword: hasPasswordEntered,
        passkeyAssertion: assertion
      });
    } catch (err: unknown) {
      console.error("Passkey authentication error:", err);
      onError(formatApiErrorMessage(err, t));
    } finally {
      setPasskeyLoading(false);
    }
  };

  const handleStep3Submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();

    if (mfaMethod === "totp") {
      const cleanToken = totpToken.replace(/\s/g, "");
      if (cleanToken.length !== 6) {
        onError(t("auth.totpFormatError", "Please enter a valid 6-digit code"));
        return;
      }
      const salt = crypto.randomUUID();
      const hashHex = await hashTotpToken(cleanToken, salt);
      await executeLogin({
        useEnteredPassword: hasPasswordEntered,
        totpTokenHash: hashHex,
        totpSalt: salt
      });
    } else if (mfaMethod === "recovery") {
      const normalizedKey = recoveryKey.replace(/[-\s]/g, "");
      if (!normalizedKey) {
        onError(t("auth.recoveryKeyRequired", "Please enter your recovery key"));
        return;
      }
      await executeLogin({
        useEnteredPassword: hasPasswordEntered,
        recoveryKey: normalizedKey
      });
    }
  };

  const resetMfaFields = (): void => {
    setTotpToken("");
    setRecoveryKey("");
    setPasskeyLoading(false);
    setMfaMethod("passkey");
  };

  return {
    mfaMethod,
    setMfaMethod,
    totpToken,
    setTotpToken,
    recoveryKey,
    setRecoveryKey,
    passkeyLoading,
    setPasskeyLoading,
    handlePasskeyLogin,
    handleStep3Submit,
    resetMfaFields
  };
}
