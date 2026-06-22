import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Card,
  Elevation,
  H4,
  Button,
  HTMLSelect,
  Intent
} from "@blueprintjs/core";
import { ShieldCheck } from "lucide-react";
import { updateMe, lockSession } from "../../../services";
import type { UserInfo } from "../../../services";
import { SetupPinDialog } from "./SetupPinDialog";
import { DisablePinDialog } from "./DisablePinDialog";

interface SessionLockCardProps {
  user: UserInfo | null;
  onRefresh: () => void;
}

export const SessionLockCard: React.FC<SessionLockCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  const [loading, setLoading] = useState<boolean>(false);

  // Modal / Setup state
  const [setupDialogOpen, setSetupDialogOpen] = useState(false);
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);

  const isPinEnabled = !!user?.pin_enabled;
  const timeout = user?.session_lock_timeout || 15;

  const handleTimeoutChange = async (e: React.FormEvent<HTMLSelectElement>) => {
    const val = Number(e.currentTarget.value);
    setLoading(true);
    try {
      await updateMe({ session_lock_timeout: val });
      onRefresh();
    } catch (err) {
      console.error("Failed to change session lock timeout", err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenSetup = () => {
    setSetupDialogOpen(true);
  };

  const handleOpenDisable = () => {
    setDisableDialogOpen(true);
  };

  const handleSetupSuccess = () => {
    setSetupDialogOpen(false);
    onRefresh();
  };

  const handleDisableSuccess = () => {
    setDisableDialogOpen(false);
    onRefresh();
  };

  const handleLockNow = async () => {
    setLoading(true);
    try {
      await lockSession();
      window.dispatchEvent(new Event("session_paused"));
    } catch (err) {
      console.error("Failed to lock session immediately", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-indigo-600" />
          <H4 className="m-0!">{t("auth.sessionLockTitle", "Idle Session Lock")}</H4>
        </div>
      </div>

      <p className="text-gray-500 text-sm mb-4">
        {t(
          "auth.sessionLockDesc",
          "Lock the interface with a 4-digit PIN when the application is idle to protect active sessions from unauthorized physical access."
        )}
      </p>

      {/* Configurations */}
      <div className="flex flex-col gap-4 mb-4">
        <div className="flex items-center justify-between">
          <span>{t("auth.inactivityTimeout", "Inactivity Timeout")}</span>
          <HTMLSelect
            value={timeout}
            onChange={handleTimeoutChange}
            disabled={!isPinEnabled || loading}
            options={[
              { label: t("auth.timeout1m", "1 Minute"), value: 1 },
              { label: t("auth.timeout2m", "2 Minutes"), value: 2 },
              { label: t("auth.timeout5m", "5 Minutes"), value: 5 },
              { label: t("auth.timeout15m", "15 Minutes"), value: 15 },
              { label: t("auth.timeout30m", "30 Minutes"), value: 30 },
              { label: t("auth.timeout60m", "60 Minutes"), value: 60 }
            ]}
          />
        </div>
      </div>

      {/* PIN configuration controls */}
      <div className="flex flex-wrap items-center gap-3">
        {isPinEnabled ? (
          <>
            <Button icon="edit" onClick={handleOpenSetup} disabled={loading}>
              {t("auth.changePin", "Change PIN")}
            </Button>
            <Button icon="trash" intent={Intent.DANGER} onClick={handleOpenDisable} disabled={loading}>
              {t("auth.disablePin", "Disable PIN & Lock")}
            </Button>
            <Button icon="lock" intent={Intent.WARNING} onClick={handleLockNow} disabled={loading}>
              {t("auth.lockNow", "Lock Now")}
            </Button>
          </>
        ) : (
          <Button icon="key" intent={Intent.PRIMARY} onClick={handleOpenSetup} disabled={loading}>
            {t("auth.configurePin", "Configure 4-Digit PIN")}
          </Button>
        )}
      </div>

      {/* Dialog Components */}
      <SetupPinDialog
        isOpen={setupDialogOpen}
        onClose={() => setSetupDialogOpen(false)}
        user={user}
        onSuccess={handleSetupSuccess}
      />

      <DisablePinDialog
        isOpen={disableDialogOpen}
        onClose={() => setDisableDialogOpen(false)}
        user={user}
        onSuccess={handleDisableSuccess}
      />
    </Card>
  );
};
