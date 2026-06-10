import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { TOTPRecoveryKeys } from "./totp/TOTPRecoveryKeys";
import { TOTPEnabledState } from "./totp/TOTPEnabledState";
import { TOTPSetupForm } from "./totp/TOTPSetupForm";

export interface TOTPCardProps {
  user: UserInfo;
  onRefresh: () => void;
  clientIp?: string;
}

/**
 * TOTPCard serves as the coordinator for Two-Factor Authentication settings.
 * It manages the setup, disable, recovery, and toggling logic, while delegating the rendering
 * to specialized state components (TOTPRecoveryKeys, TOTPEnabledState, TOTPSetupForm).
 *
 * @param props - Component props containing user details and refresh callback.
 * @returns React elements representing the current state of 2FA.
 */
export const TOTPCard: React.FC<TOTPCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  // Setup flow state
  const [setupData, setSetupData] = useState<{
    secret: string;
    uri: string;
  } | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [recoveryKeys, setRecoveryKeys] = useState<string[] | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [copied, setCopied] = useState(false);

  // Disable flow state
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState("");

  // Settings
  const [settingsLoading, setSettingsLoading] = useState(false);

  const handleStartSetup = async () => {
    setSetupLoading(true);
    setSetupError("");
    try {
      const res = await fetch("/api/account/totp/setup");
      if (res.ok) {
        setSetupData(await res.json());
      } else {
        setSetupError(await res.text());
      }
    } catch {
      setSetupError(t("common.errorNetwork"));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleConfirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData) return;
    setSetupLoading(true);
    setSetupError("");
    try {
      const rawToken = setupToken.replace(/\s/g, "");
      const salt = crypto.randomUUID();
      const msgBuffer = new TextEncoder().encode(rawToken + salt);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      const res = await fetch("/api/account/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: setupData.secret,
          totpTokenHash: hashHex,
          salt: salt
        })
      });
      if (res.ok) {
        const data = await res.json();
        setRecoveryKeys(data.recovery_keys);
        setSetupData(null);
        setSetupToken("");
        onRefresh();
      } else {
        setSetupError(await res.text());
      }
    } catch {
      setSetupError(t("common.errorNetwork"));
    } finally {
      setSetupLoading(false);
    }
  };

  const handleCopyRecoveryKeys = () => {
    if (!recoveryKeys) return;
    navigator.clipboard.writeText(recoveryKeys.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDisable = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    setDisableLoading(true);
    setDisableError("");
    try {
      const res = await fetch("/api/account/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword })
      });
      if (res.ok) {
        setDisableDialogOpen(false);
        setDisablePassword("");
        onRefresh();
      } else {
        setDisableError(await res.text());
      }
    } catch {
      setDisableError(t("common.errorNetwork"));
    } finally {
      setDisableLoading(false);
    }
  };

  const handleToggleSkipPassword = async (val: boolean) => {
    setSettingsLoading(true);
    try {
      await fetch("/api/account/totp/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip_password: val })
      });
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setSettingsLoading(false);
    }
  };

  // Phase 1: show recovery keys after setup
  if (recoveryKeys) {
    return (
      <TOTPRecoveryKeys
        recoveryKeys={recoveryKeys}
        copied={copied}
        onCopy={handleCopyRecoveryKeys}
        onDone={() => setRecoveryKeys(null)}
      />
    );
  }

  // Phase 2: TOTP enabled — show settings
  if (user.totp_enabled) {
    return (
      <TOTPEnabledState
        user={user}
        settingsLoading={settingsLoading}
        onToggleSkipPassword={handleToggleSkipPassword}
        disableDialogOpen={disableDialogOpen}
        setDisableDialogOpen={setDisableDialogOpen}
        disablePassword={disablePassword}
        setDisablePassword={setDisablePassword}
        disableError={disableError}
        setDisableError={setDisableError}
        disableLoading={disableLoading}
        onDisable={handleDisable}
      />
    );
  }

  // Phase 3: TOTP not yet enabled — show setup or QR/confirm
  return (
    <TOTPSetupForm
      setupData={setupData}
      setupToken={setupToken}
      setSetupToken={setSetupToken}
      setupError={setupError}
      setupLoading={setupLoading}
      onStartSetup={handleStartSetup}
      onConfirmSetup={handleConfirmSetup}
      onCancel={() => {
        setSetupData(null);
        setSetupToken("");
        setSetupError("");
      }}
    />
  );
};
