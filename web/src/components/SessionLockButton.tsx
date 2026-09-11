import React, { useState } from "react";
import { Button, Spinner } from "@blueprintjs/core";
import { Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { lockSession } from "../services";
import type { UserInfo } from "../types/auth";

export interface SessionLockButtonProps {
  /** Current logged in user info. Used to check if PIN is configured. */
  currentUser?: UserInfo | null;
  /** Whether button uses minimal styling. Defaults to true to match LanguageSwitcher. */
  minimal?: boolean;
  /** Size of the button. Defaults to "small" to match LanguageSwitcher. */
  size?: "small" | "medium" | "large";
}

/**
 * SessionLockButton renders a lock button in the top navbar when PIN code is configured.
 * Styled identically to LanguageSwitcher (minimal variant, small size, 14px icon).
 */
export const SessionLockButton: React.FC<SessionLockButtonProps> = ({
  currentUser,
  minimal = true,
  size = "small",
}) => {
  const { t } = useTranslation();
  const [locking, setLocking] = useState(false);

  // Render only if PIN is configured on the user account
  if (!currentUser?.pin_enabled) {
    return null;
  }

  const handleLock = async () => {
    if (locking) return;
    setLocking(true);
    try {
      await lockSession();
    } catch (err) {
      console.warn("Failed to lock session on server", err);
    } finally {
      sessionStorage.setItem("obex_session_locked", "true");
      window.dispatchEvent(new Event("session_paused"));
      setLocking(false);
    }
  };

  return (
    <Button
      variant={minimal ? "minimal" : undefined}
      size={size}
      icon={locking ? <Spinner size={14} /> : <Lock size={14} />}
      onClick={handleLock}
      disabled={locking}
      title={t("auth.lockNow", "Lock Now")}
      aria-label={t("auth.lockNow", "Lock Now")}
    />
  );
};
