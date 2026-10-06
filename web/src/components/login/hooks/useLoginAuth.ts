import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  hashPasswordClient,
  deriveStoredHashClient,
  hmacSha256,
  isPasswordLeaked,
  formatApiErrorMessage
} from "../../../utils/auth";
import { setAccessToken } from "../../../utils/token";
import { login, ApiError, migratePassword } from "../../../services";
import { e2ee } from "../../../services/e2ee";

export interface LoginCredentials {
  useEnteredPassword?: boolean;
  passkeyAssertion?: unknown;
  totpTokenHash?: string;
  totpSalt?: string;
  recoveryKey?: string;
}

export interface UseLoginAuthProps {
  username: string;
  password: string;
  passwordVersion: number;
  nonce?: string;
  serverSalt?: string | null;
  keepLoggedIn: boolean;
  onSuccess: () => void;
}

export interface UseLoginAuthReturn {
  loading: boolean;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  rotatedRecoveryKey: string | null;
  setRotatedRecoveryKey: React.Dispatch<React.SetStateAction<string | null>>;
  executeLogin: (credentials: LoginCredentials) => Promise<void>;
}

/**
 * Hook to execute authentication API requests and handle password challenges,
 * credential migration, and E2EE recovery key rotation.
 */
export function useLoginAuth({
  username,
  password,
  passwordVersion,
  nonce,
  serverSalt,
  keepLoggedIn,
  onSuccess
}: UseLoginAuthProps): UseLoginAuthReturn {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [rotatedRecoveryKey, setRotatedRecoveryKey] = useState<string | null>(null);

  const { t } = useTranslation();

  const executeLogin = async (credentials: LoginCredentials): Promise<void> => {
    setLoading(true);
    setError("");

    try {
      const body: {
        password?: string;
        recoveryKey?: string;
        totpTokenHash?: string;
        totpSalt?: string;
        passkeyAssertion?: unknown;
        keepLoggedIn?: boolean;
      } = {
        keepLoggedIn,
        passkeyAssertion: credentials.passkeyAssertion,
        totpTokenHash: credentials.totpTokenHash,
        totpSalt: credentials.totpSalt,
        recoveryKey: credentials.recoveryKey
      };

      // If user entered password, compute challenge response
      if (credentials.useEnteredPassword && password) {
        if (passwordVersion === 2) {
          if (!nonce || !serverSalt) {
            throw new Error(t("auth.sessionExpired", "Session expired, please start over"));
          }
          const clientHash = await hashPasswordClient(password, username);
          const storedHash = await deriveStoredHashClient(clientHash, serverSalt);
          body.password = await hmacSha256(storedHash, nonce);
        } else {
          body.password = password;
        }
      }

      const data = await login(body);
      if (data.accessToken) {
        setAccessToken(data.accessToken);
      }
      if (data.needsMigration && password) {
        const clientHash = await hashPasswordClient(password, username);
        await migratePassword(clientHash);
      }
      if (data.rotatedRecoveryKey && credentials.recoveryKey) {
        // Recovery key was used to login and automatically rotated
        try {
          await e2ee.unlockWithRecoveryKey(credentials.recoveryKey);
          await e2ee.wrapCurrentKeyForRecovery(data.rotatedRecoveryKey);
        } catch (e) {
          console.warn("[Login] Could not auto re-wrap E2EE key with rotated recovery key:", e);
        }
        setRotatedRecoveryKey(data.rotatedRecoveryKey);
        return;
      }
      onSuccess();
    } catch (err: unknown) {
      if (err instanceof ApiError) {
        const fakeRes = { status: err.status } as Response;
        if (isPasswordLeaked(fakeRes, err.bodyText)) {
          setError(t("auth.passwordLeaked"));
        } else {
          setError(formatApiErrorMessage(err, t));
        }
      } else {
        setError(formatApiErrorMessage(err, t));
      }
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    setError,
    rotatedRecoveryKey,
    setRotatedRecoveryKey,
    executeLogin
  };
}
