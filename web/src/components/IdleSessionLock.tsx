import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Spinner, Card, Elevation, Callout, Intent } from "@blueprintjs/core";
import { LogOut } from "lucide-react";
import { hashPin, hashChallenge } from "../utils/auth";
import { unlockSession, lockSession, getUnlockNonce, ApiError } from "../services";
import type { UserInfo } from "../services";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { DigitInput, type DigitInputRef } from "./DigitInput";

interface IdleSessionLockProps {
  currentUser: UserInfo | null;
  handleLogout: () => Promise<void>;
  onUnlock?: () => void;
  children: React.ReactNode;
}

export const IdleSessionLock: React.FC<IdleSessionLockProps> = ({
  currentUser,
  handleLogout,
  onUnlock,
  children
}) => {
  const { t } = useTranslation();
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    return sessionStorage.getItem("obex_session_locked") === "true";
  });
  const [pin, setPin] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const lastActivityRef = useRef<number>(0);
  const digitInputRef = useRef<DigitInputRef>(null);

  // Read configurations from currentUser (backend single source of truth)
  const timeoutMinutes = currentUser?.session_lock_timeout ?? 15;
  const isPinSet = !!currentUser?.pin_enabled;
  const isLockEnabled = isPinSet;

  // Listen to user activity to reset inactivity timer
  useEffect(() => {
    if (!isLockEnabled || !isPinSet || isLocked || !currentUser) return;

    lastActivityRef.current = Date.now();
    const resetTimer = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ["mousemove", "mousedown", "keypress", "scroll", "touchstart", "click"];
    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    // Inactivity check loop
    const interval = setInterval(async () => {
      const inactiveMs = Date.now() - lastActivityRef.current;
      const timeoutMs = timeoutMinutes * 60 * 1000;
      if (inactiveMs >= timeoutMs) {
        setIsLocked(true);
        sessionStorage.setItem("obex_session_locked", "true");
        try {
          await lockSession();
        } catch (e) {
          console.warn("Failed to lock session on backend", e);
        }
      }
    }, 10000); // Check every 10 seconds

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
      clearInterval(interval);
    };
  }, [isLockEnabled, isPinSet, isLocked, timeoutMinutes, currentUser]);

  // Listen to the session_paused custom event from interceptor
  useEffect(() => {
    const handlePaused = () => {
      setIsLocked(true);
      sessionStorage.setItem("obex_session_locked", "true");
    };

    window.addEventListener("session_paused", handlePaused);
    return () => {
      window.removeEventListener("session_paused", handlePaused);
    };
  }, []);

  // Focus the input when lock screen becomes active
  useEffect(() => {
    if (isLocked) {
      setTimeout(() => {
        digitInputRef.current?.focus();
      }, 100);
    }
  }, [isLocked]);

  const submitUnlock = async (pinValue?: string) => {
    const pinToSubmit = pinValue || pin;
    if (!pinToSubmit) return;
    setLoading(true);
    setError("");
    try {
      const userId = currentUser?.id || sessionStorage.getItem("obex_user_id");
      if (!userId) {
        setError(t("auth.sessionExpired", "Session expired. Logging out..."));
        setTimeout(() => {
          handleLogout();
        }, 1500);
        return;
      }
      // Get challenge nonce from server
      const { nonce, legacy } = await getUnlockNonce();

      // Compute pinHash = hashPin(pinToSubmit, userId)
      const pinHash = await hashPin(pinToSubmit, userId);

      if (legacy) {
        // Legacy flow: send the raw pinHash directly (server will verify and auto-migrate)
        await unlockSession(pinHash, nonce);
      } else {
        // Modern challenge-response flow
        const challengedHash = await hashChallenge(pinHash, nonce);
        await unlockSession(challengedHash, nonce);
      }
      
      // Success! Unlock session
      setIsLocked(false);
      sessionStorage.removeItem("obex_session_locked");
      setPin("");
      setError("");
      setAttemptsRemaining(null);
      // Reset activity clock
      lastActivityRef.current = Date.now();
      if (onUnlock) {
        onUnlock();
      }
    } catch (err) {
      setPin(""); // Clear PIN on error
      if (err instanceof ApiError) {
        if (err.status === 401 && err.bodyText.includes("too_many_attempts")) {
          setError(t("auth.sessionExpired", "Too many failed attempts. Session terminated."));
          setTimeout(() => {
            handleLogout();
          }, 1500);
        } else if (err.status === 400 || err.status === 401) {
          let attemptsLeft = 3;
          try {
            const body = JSON.parse(err.bodyText);
            if (body && typeof body.attemptsRemaining === "number") {
              attemptsLeft = body.attemptsRemaining;
            }
          } catch (e) {
            console.debug("Failed to parse attemptsRemaining from body", e);
          }
          setAttemptsRemaining(attemptsLeft);
          setError(t("auth.pinIncorrect", "Incorrect PIN"));
          setTimeout(() => {
            digitInputRef.current?.focus();
          }, 50);
        } else {
          setError(t("auth.networkError", "Network error. Please try again."));
        }
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("common.errorNetwork"));
      }
    } finally {
      setLoading(false);
    }
  };

  if (isLocked) {
    return (
      <div 
        className="fixed inset-0 z-9999 flex flex-col items-center justify-center p-4"
        style={{
          background: "radial-gradient(circle at center, #1b202e 0%, #0d0f14 100%)",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          userSelect: "none"
        }}
      >
        <div className="w-full max-w-md">
          <Card
            elevation={Elevation.FOUR}
            className="w-full p-8 rounded-2xl shadow-none! dark:bg-gray-900 border border-gray-100 dark:border-gray-800 flex flex-col items-center"
            onClick={() => digitInputRef.current?.focus()}
          >
            {/* Logo & Header */}
            <div className="flex flex-col items-center mb-8">
              <img
                src={LogoIcon}
                alt="DNS Worker Logo"
                className="w-20 h-20 object-contain"
              />
              {(() => {
                const displayUsername = currentUser?.username || sessionStorage.getItem("obex_username") || "";
                return displayUsername ? (
                  <h3 className="font-bold tracking-tight text-2xl mt-4 text-slate-900 dark:text-slate-100">
                    {displayUsername}
                  </h3>
                ) : null;
              })()}
              <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
                {t("auth.sessionLocked", "Session Locked due to inactivity")}
              </p>
            </div>

            {/* Error or Attempts Remaining Callout */}
            {error && (
              <Callout
                intent={Intent.DANGER}
                className="w-full mb-6 rounded-xl text-center"
              >
                <div className="text-sm font-medium">{error}</div>
                {attemptsRemaining !== null && (
                  <div className="text-xs mt-1 opacity-80">
                    {t("auth.attemptsRemaining", "{{count}} attempts remaining", { count: attemptsRemaining })}
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
                onComplete={(val) => submitUnlock(val)}
              />
            </div>

            {/* Submit loader */}
            {loading && (
              <div className="mb-4">
                <Spinner size={24} />
              </div>
            )}

            {/* Logout button */}
            <div className="w-full flex justify-center mt-4">
              <Button
                minimal
                intent={Intent.NONE}
                icon={<LogOut size={16} />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleLogout();
                }}
                className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {t("auth.logoutAndReturn", "Log Out Session")}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
