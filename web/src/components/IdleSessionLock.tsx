import React, { useState, useEffect, useRef } from "react";
import { lockSession } from "../services";
import type { UserInfo } from "../services";
import { AuthView } from "./AuthView";

/**
 * Properties for the IdleSessionLock component.
 */
interface IdleSessionLockProps {
  /** Current logged in user info. */
  currentUser: UserInfo | null;
  /** Function invoked to log out and terminate current session. */
  handleLogout: () => Promise<void>;
  /** Callback triggered when user successfully enters PIN and unlocks session. */
  onUnlock?: () => void;
  /** Child application components to render when session is unlocked. */
  children: React.ReactNode;
}

/**
 * IdleSessionLock manages inactivity tracking and pauses the session when idle.
 * When locked, it renders the unified AuthView in lock screen mode with ScrollingIntro.
 *
 * @param props - Component props containing user details and child nodes.
 * @returns React elements representing the locked AuthView or children.
 */
export const IdleSessionLock: React.FC<IdleSessionLockProps> = ({
  currentUser,
  handleLogout,
  onUnlock,
  children,
}): React.ReactElement => {
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    return sessionStorage.getItem("obex_session_locked") === "true";
  });

  const lastActivityRef = useRef<number>(0);

  // Read configurations from currentUser (backend single source of truth)
  const timeoutMinutes = currentUser?.session_lock_timeout ?? 15;
  const isPinSet = !!currentUser?.pin_enabled;
  const isLockEnabled = isPinSet;

  // Listen to user activity to reset inactivity timer
  useEffect(() => {
    if (!isLockEnabled || !isPinSet || isLocked || !currentUser) return;

    lastActivityRef.current = Date.now();
    const resetTimer = (): void => {
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
    const handlePaused = (): void => {
      setIsLocked(true);
      sessionStorage.setItem("obex_session_locked", "true");
    };

    window.addEventListener("session_paused", handlePaused);
    return () => {
      window.removeEventListener("session_paused", handlePaused);
    };
  }, []);

  const handleUnlockSuccess = (): void => {
    setIsLocked(false);
    sessionStorage.removeItem("obex_session_locked");
    lastActivityRef.current = Date.now();
    if (onUnlock) {
      onUnlock();
    }
  };

  if (isLocked) {
    return (
      <div className="fixed inset-0 z-9999 bg-white dark:bg-gray-950">
        <AuthView
          isLocked={true}
          currentUser={currentUser}
          onUnlock={handleUnlockSuccess}
          handleLogout={handleLogout}
        />
      </div>
    );
  }

  return <>{children}</>;
};
