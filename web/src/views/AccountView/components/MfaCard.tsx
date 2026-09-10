import React, { useState } from "react";
import { Card, Elevation, H4, Tag, Intent, Switch, Callout, Divider } from "@blueprintjs/core";
import { ShieldCheck, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";
import { updateMfaSettings } from "../../../services";
import { PasskeyCard } from "./PasskeyCard";
import { TOTPCard } from "./TOTPCard";

/**
 * Properties for the MfaCard component.
 */
export interface MfaCardProps {
  /** The current user profile and security state. */
  user: UserInfo;
  /** Callback triggered to re-fetch the latest user data. */
  onRefresh: () => void;
}

/**
 * MfaCard provides a unified control center for Multi-Factor Authentication (MFA).
 * It presents overall MFA status, allows toggling passwordless login (when MFA is configured
 * via either Passkey or TOTP), and embeds both PasskeyCard and TOTPCard.
 *
 * @param props - Component props containing the user object and refresh callback.
 * @returns React element representing the unified MFA section.
 */
export const MfaCard: React.FC<MfaCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();
  const [settingsLoading, setSettingsLoading] = useState(false);

  const isMfaEnabled = !!(
    user.mfa_enabled ??
    (user.totp_enabled || (user.passkeys_count && user.passkeys_count > 0))
  );

  const handleToggleSkipPassword = async (val: boolean) => {
    setSettingsLoading(true);
    try {
      await updateMfaSettings(val);
      onRefresh();
    } catch (e: any) {
      alert(e.message || t("common.errorNetwork", "Network error"));
    } finally {
      setSettingsLoading(false);
    }
  };

  return (
    <Card elevation={Elevation.ONE} className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck
              size={20}
              className={isMfaEnabled ? "text-green-500" : "text-gray-400"}
            />
            <H4 style={{ margin: 0 }}>
              {t("account.mfa.title", "Multi-Factor Authentication (MFA)")}
            </H4>
            <Tag intent={isMfaEnabled ? Intent.SUCCESS : Intent.NONE} minimal round>
              {isMfaEnabled
                ? t("account.mfa.enabled", "Configured")
                : t("account.mfa.notConfigured", "Not Configured")}
            </Tag>
          </div>
        </div>

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t(
            "account.mfa.desc",
            "Passkeys and Authenticator Apps (TOTP) both serve as MFA authentication methods. Configuring at least one factor protects your account and enables passwordless login and self-service password recovery."
          )}
        </p>

        {isMfaEnabled ? (
          <>
            <Divider className="my-3" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
              <div>
                <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
                  {t("account.mfa.passwordlessTitle", "Passwordless Login")}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t(
                    "account.mfa.passwordlessDesc",
                    "When enabled, logging in will skip the password requirement and verify your identity directly via Passkey or TOTP."
                  )}
                </div>
              </div>
              <Switch
                checked={!!user.totp_skip_password}
                onChange={(e) => handleToggleSkipPassword(e.currentTarget.checked)}
                disabled={settingsLoading}
                className="mb-0 shrink-0"
              />
            </div>
          </>
        ) : (
          <Callout intent={Intent.PRIMARY} icon={<KeyRound size={16} style={{ display: "inline-flex", alignItems: "center", marginRight: "8px" }} />}>
            {t(
              "account.mfa.unconfiguredHint",
              "No MFA method configured yet. Set up either a Passkey or Authenticator App below to safeguard your account and unlock passwordless login and account recovery."
            )}
          </Callout>
        )}
      </div>

      <Divider />

      {/* Section 1: Passkey */}
      <PasskeyCard onRefresh={onRefresh} />

      <Divider />

      {/* Section 2: TOTP */}
      <TOTPCard user={user} onRefresh={onRefresh} />
    </Card>
  );
};
