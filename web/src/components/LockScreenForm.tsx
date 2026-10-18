import React, { useState, useEffect, useRef } from "react";
import { H3, Intent, Callout, Button, Spinner } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { DigitInput, type DigitInputRef } from "./DigitInput";
import { hashPin, hashChallenge } from "../utils/auth";
import { unlockSession, getUnlockNonce, ApiError } from "../services";
import type { UserInfo } from "../services";

/**
 * Properties for the LockScreenForm component.
 */
export interface LockScreenFormProps {
  /** Current user information for the locked session. */
  currentUser?: UserInfo | null;
  /** Callback invoked upon successful session unlock. */
  onUnlock?: () => void;
  /** Callback invoked to log out and terminate the locked session. */
  handleLogout?: () => Promise<void>;
}

/**
 * LockScreenForm renders the PIN code unlock form for a locked session.
 * Designed to integrate seamlessly into AuthView, sharing the card container and ScrollingIntro.
 *
 * @param props - Component props containing user details and callbacks.
 * @returns React elements for the unlock form.
 */
export const LockScreenForm: React.FC<LockScreenFormProps> = ({
  currentUser,
  onUnlock,
  handleLogout,
}): React.ReactElement => {
  const { t } = useTranslation();
  const [pin, setPin] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);
  const digitInputRef = useRef<DigitInputRef>(null);

  // Focus the first PIN input digit on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      digitInputRef.current?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  /**
   * Submits the entered PIN to the unlock API endpoint.
   *
   * @param pinValue - Optional direct PIN value from digit completion.
   */
  const submitUnlock = async (pinValue?: string): Promise<void> => {
    const pinToSubmit = pinValue || pin;
    if (!pinToSubmit || pinToSubmit.length < 4) return;

    setLoading(true);
    setError("");

    try {
      const userId = currentUser?.id || sessionStorage.getItem("obex_user_id");
      if (!userId) {
        setError(t("auth.sessionExpired", "会话已过期，正在退出..."));
        setTimeout(() => {
          handleLogout?.();
        }, 1500);
        return;
      }

      // Fetch challenge nonce from server
      const { nonce, legacy } = await getUnlockNonce();
      const pinHash = await hashPin(pinToSubmit, userId);

      if (legacy) {
        await unlockSession(pinHash, nonce);
      } else {
        const challengedHash = await hashChallenge(pinHash, nonce);
        await unlockSession(challengedHash, nonce);
      }

      // Unlock successful
      setPin("");
      setError("");
      setAttemptsRemaining(null);
      if (onUnlock) {
        onUnlock();
      }
    } catch (err: unknown) {
      setPin(""); // Clear PIN on failure for immediate retry
      if (err instanceof ApiError) {
        if (err.status === 401 && err.bodyText.includes("too_many_attempts")) {
          setError(t("auth.sessionExpired", "尝试次数过多，会话已终结。"));
          setTimeout(() => {
            handleLogout?.();
          }, 1500);
        } else if (err.status === 400 || err.status === 401) {
          let attemptsLeft = 3;
          try {
            const body = JSON.parse(err.bodyText) as { attemptsRemaining?: number };
            if (typeof body?.attemptsRemaining === "number") {
              attemptsLeft = body.attemptsRemaining;
            }
          } catch {
            // Ignore JSON parse failure and fallback to default
          }
          setAttemptsRemaining(attemptsLeft);
          setError(t("auth.pinIncorrect", "PIN 码错误"));
          setTimeout(() => {
            digitInputRef.current?.focus();
          }, 50);
        } else {
          setError(t("auth.networkError", "网络错误，请稍后重试。"));
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("common.errorNetwork", "网络异常"));
      }
    } finally {
      setLoading(false);
    }
  };

  const displayUsername = currentUser?.username || sessionStorage.getItem("obex_username") || "";

  return (
    <div
      className="flex flex-col items-center select-none"
      onClick={() => digitInputRef.current?.focus()}
    >
      {/* Logo & Header */}
      <div className="flex flex-col items-center mb-8">
        <img
          src={LogoIcon}
          alt="DNS Worker Logo"
          className="w-20 h-20 object-contain"
        />
        {displayUsername && (
          <H3 className="font-bold tracking-tight text-2xl mt-4 text-slate-900 dark:text-slate-100">
            {displayUsername}
          </H3>
        )}
        <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
          {t("auth.sessionLocked", "由于长时间未活动，会话已锁定")}
        </p>
      </div>

      {/* Error / Attempts Remaining Callout */}
      {error && (
        <Callout
          intent={Intent.DANGER}
          className="w-full mb-6 rounded-xl text-center"
        >
          <div className="text-sm font-medium">{error}</div>
          {attemptsRemaining !== null && (
            <div className="text-xs mt-1 opacity-80">
              {t("auth.attemptsRemaining", "还剩 {{count}} 次尝试机会", { count: attemptsRemaining })}
            </div>
          )}
        </Callout>
      )}

      {/* PIN Digit Input */}
      <div className="w-full flex justify-center mb-6">
        <DigitInput
          ref={digitInputRef}
          length={4}
          value={pin}
          onChange={setPin}
          disabled={loading}
          type="password"
          error={!!error}
          autoFocus={true}
          onComplete={(val: string) => submitUnlock(val)}
        />
      </div>

      {/* Submit loader */}
      {loading && (
        <div className="mb-4">
          <Spinner size={24} />
        </div>
      )}

      {/* Logout button */}
      {handleLogout && (
        <div className="w-full flex justify-center mt-2">
          <Button
            minimal
            intent={Intent.NONE}
            icon={<LogOut size={16} />}
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              handleLogout();
            }}
            className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            {t("auth.logoutAndReturn", "登出会话")}
          </Button>
        </div>
      )}
    </div>
  );
};
