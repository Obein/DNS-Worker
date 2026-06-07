import React, { useState } from "react";
import {
  Card,
  Elevation,
  H4,
  Callout,
  Intent,
  Button,
  Tag,
  Switch,
  Divider,
  Dialog,
  FormGroup,
  InputGroup,
} from "@blueprintjs/core";
import { ShieldCheck, Copy, Shield, ShieldOff, Smartphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QRCodeCanvas } from "./QRCodeCanvas";
import type {  UserInfo  } from "../types";

export interface TOTPCardProps {
  user: UserInfo;
  onRefresh: () => void;
  clientIp?: string;
}

export const TOTPCard: React.FC<TOTPCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  // Setup flow state
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
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
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const res = await fetch("/api/account/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: setupData.secret,
          token: hashHex,
          salt: salt,
        }),
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

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableLoading(true);
    setDisableError("");
    try {
      const res = await fetch("/api/account/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
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
        body: JSON.stringify({ skip_password: val }),
      });
      onRefresh();
    } catch {
      /* ignore */
    } finally {
      setSettingsLoading(false);
    }
  };

  // Phase: show recovery keys after setup
  if (recoveryKeys) {
    return (
      <Card elevation={Elevation.ONE}>
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={20} className="text-green-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.totp.recoveryKeysTitle", "Save Your Recovery Keys")}
          </H4>
        </div>
        <Callout intent={Intent.WARNING} className="mb-4">
          {t(
            "account.totp.recoveryKeysWarning",
            "Store these keys safely. Each key can only be used once. You will NOT see them again."
          )}
        </Callout>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {recoveryKeys.map((key, i) => (
            <code
              key={i}
              className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded text-center tracking-wider"
            >
              {key}
            </code>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            fill
            icon={<Copy size={14} />}
            text={
              copied
                ? t("account.totp.copied", "Copied!")
                : t("account.totp.copyKeys", "Copy All Keys")
            }
            intent={copied ? Intent.SUCCESS : Intent.NONE}
            onClick={handleCopyRecoveryKeys}
          />
          <Button
            fill
            intent={Intent.PRIMARY}
            text={t("account.totp.done", "Done, I've saved them")}
            onClick={() => setRecoveryKeys(null)}
          />
        </div>
      </Card>
    );
  }

  // Phase: TOTP enabled — show settings
  if (user.totp_enabled) {
    return (
      <Card elevation={Elevation.ONE}>
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} className="text-green-500" />
          <H4 style={{ margin: 0 }}>
            {t("account.totp.title", "Two-Factor Authentication")}
          </H4>
          <Tag intent={Intent.SUCCESS} minimal round>
            {t("account.totp.enabled", "Enabled")}
          </Tag>
        </div>
        <div className="space-y-4">
          <Switch
            label={t(
              "account.totp.skipPassword",
              "Passwordless login (TOTP only — hide password field)"
            )}
            checked={!!user.totp_skip_password}
            onChange={(e) => handleToggleSkipPassword(e.currentTarget.checked)}
            disabled={settingsLoading}
          />
          <Divider />
          <Button
            intent={Intent.DANGER}
            outlined
            icon={<ShieldOff size={14} />}
            text={t("account.totp.disable", "Disable Two-Factor Authentication")}
            onClick={() => setDisableDialogOpen(true)}
          />
        </div>

        <Dialog
          isOpen={disableDialogOpen}
          onClose={() => {
            setDisableDialogOpen(false);
            setDisablePassword("");
            setDisableError("");
          }}
          title={t("account.totp.disableTitle", "Disable 2FA")}
          icon="shield"
        >
          <div className="p-6 space-y-4">
            <Callout intent={Intent.WARNING}>
              {t(
                "account.totp.disableWarning",
                "After disabling 2FA, your account will only be protected by password."
              )}
            </Callout>
            {disableError && <Callout intent={Intent.DANGER}>{disableError}</Callout>}
            {!user.totp_skip_password && (
              <form onSubmit={handleDisable} className="space-y-4">
                <FormGroup label={t("account.currentPassword")}>
                  <InputGroup
                    type="password"
                    leftIcon="lock"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    required
                  />
                </FormGroup>
                <div className="flex justify-end gap-2">
                  <Button
                    text={t("account.cancel")}
                    onClick={() => setDisableDialogOpen(false)}
                  />
                  <Button
                    intent={Intent.DANGER}
                    text={t("account.totp.confirmDisable", "Disable 2FA")}
                    type="submit"
                    loading={disableLoading}
                  />
                </div>
              </form>
            )}
            {user.totp_skip_password && (
              <div className="flex justify-end gap-2">
                <Button
                  text={t("account.cancel")}
                  onClick={() => setDisableDialogOpen(false)}
                />
                <Button
                  intent={Intent.DANGER}
                  text={t("account.totp.confirmDisable", "Disable 2FA")}
                  loading={disableLoading}
                  onClick={(e) => handleDisable(e as any)}
                />
              </div>
            )}
          </div>
        </Dialog>
      </Card>
    );
  }

  // Phase: TOTP not yet enabled — show setup or QR/confirm
  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={20} className="text-blue-500" />
        <H4 style={{ margin: 0 }}>
          {t("account.totp.title", "Two-Factor Authentication")}
        </H4>
        <Tag minimal round intent={Intent.NONE}>
          {t("account.totp.disabled", "Disabled")}
        </Tag>
      </div>

      {!setupData ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t(
              "account.totp.setupDesc",
              "Add an extra layer of security. Use Google Authenticator, Authy, or any TOTP app."
            )}
          </p>
          {setupError && <Callout intent={Intent.DANGER}>{setupError}</Callout>}
          <Button
            intent={Intent.PRIMARY}
            icon={<Shield size={14} />}
            text={t("account.totp.setupBtn", "Enable Two-Factor Authentication")}
            loading={setupLoading}
            onClick={handleStartSetup}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium">
            {t("account.totp.scanQR", "Scan this QR code with your authenticator app:")}
          </p>
          <div className="flex flex-col items-center gap-3">
            <QRCodeCanvas uri={setupData.uri} />
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">
                {t("account.totp.orEnterManually", "Or enter the key manually:")}
              </p>
              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">
                {setupData.secret}
              </code>
            </div>
          </div>
          <Divider />
          {setupError && <Callout intent={Intent.DANGER}>{setupError}</Callout>}
          <form onSubmit={handleConfirmSetup} className="space-y-3">
            <FormGroup
              label={t("account.totp.enterCode", "Enter the 6-digit code to confirm:")}
              helperText={t(
                "account.totp.enterCodeHint",
                "This verifies the key was scanned correctly."
              )}
            >
              <InputGroup
                id="totp-setup-token"
                placeholder="000000"
                value={setupToken}
                onChange={(e) =>
                  setSetupToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                }
                maxLength={6}
                inputMode="numeric"
                className="font-mono tracking-widest"
                required
              />
            </FormGroup>
            <div className="flex gap-2">
              <Button
                text={t("account.cancel")}
                onClick={() => {
                  setSetupData(null);
                  setSetupToken("");
                  setSetupError("");
                }}
              />
              <Button
                intent={Intent.SUCCESS}
                type="submit"
                loading={setupLoading}
                text={t("account.totp.activate", "Activate")}
                disabled={setupToken.length < 6}
              />
            </div>
          </form>
        </div>
      )}
    </Card>
  );
};
