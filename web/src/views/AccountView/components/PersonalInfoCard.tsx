import React from "react";
import {
  Card,
  Elevation,
  FormGroup,
  InputGroup,
  ButtonGroup,
  Button,
  Tooltip,
  Position,
  Intent,
  H4,
  HTMLSelect
} from "@blueprintjs/core";
import { User, Edit2, Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UserInfo } from "../types";

/**
 * Properties for the PersonalInfoCard component.
 */
export interface PersonalInfoCardProps {
  /** The current user information object. */
  me: UserInfo | null;
  /** State indicating if username editing mode is active. */
  isEditingUsername: boolean;
  /** Callback to set or exit username editing mode. */
  setIsEditingUsername: (editing: boolean) => void;
  /** The temporary input value for the username editor. */
  editUsername: string;
  /** Callback to update the temporary username input value. */
  setEditUsername: (username: string) => void;
  /** Indicates if update username request is loading. */
  usernameLoading: boolean;
  /** State indicating if username editor input has focus. */
  usernameFocused: boolean;
  /** Callback to update username input focus state. */
  setUsernameFocused: (focused: boolean) => void;
  /** Callback to submit username change. */
  onUpdateUsername: () => void;
  /** Callback to submit timezone change. */
  onUpdateTimezone?: (tz: string | null) => void;
  /** Callback to submit locale change. */
  onUpdateLocale?: (locale: string | null) => void;
}

/**
 * PersonalInfoCard component renders the user profile information (Username, ID).
 *
 * @param props - Component props.
 * @returns React element representing personal info card.
 */
export const PersonalInfoCard: React.FC<PersonalInfoCardProps> = ({
  me,
  isEditingUsername,
  setIsEditingUsername,
  editUsername,
  setEditUsername,
  usernameLoading,
  usernameFocused,
  setUsernameFocused,
  onUpdateUsername,
  onUpdateTimezone,
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center gap-2 mb-4">
        <User size={20} className="text-blue-500" />
        <H4 style={{ margin: 0 }}>{t("account.personalInfo")}</H4>
      </div>
      <div className="space-y-4">
        <FormGroup label={t("account.username")}>
          <div className="flex gap-2">
            {isEditingUsername ? (
              <>
                <Tooltip
                  content={t("account.formatTipUsername")}
                  isOpen={usernameFocused}
                  position={Position.TOP}
                  intent={Intent.PRIMARY}
                  className="w-full"
                >
                  <div className="w-full block">
                    <InputGroup
                      fill
                      value={editUsername}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setEditUsername(e.target.value)
                      }
                      onFocus={() => setUsernameFocused(true)}
                      onBlur={() => setUsernameFocused(false)}
                      autoFocus
                    />
                  </div>
                </Tooltip>
                <ButtonGroup>
                  <Button
                    icon={<Check size={16} />}
                    intent={Intent.SUCCESS}
                    loading={usernameLoading}
                    onClick={onUpdateUsername}
                  />
                  <Button
                    icon={<X size={16} />}
                    onClick={() => {
                      setIsEditingUsername(false);
                      setEditUsername(me?.username || "");
                    }}
                  />
                </ButtonGroup>
              </>
            ) : (
              <>
                <InputGroup fill value={me?.username} readOnly />
                <Button
                  icon={<Edit2 size={16} />}
                  onClick={() => setIsEditingUsername(true)}
                />
              </>
            )}
          </div>
        </FormGroup>
        <FormGroup label={t("account.userId")}>
          <InputGroup leftIcon="id-number" value={me?.id} disabled />
        </FormGroup>
        <FormGroup label={t("account.timezone", "Timezone")}>
          <HTMLSelect
            fill
            value={me?.timezone || ""}
            onChange={(e) => onUpdateTimezone?.(e.target.value || null)}
            options={[
              { label: t("account.timezoneAuto", "Auto (Browser Default)"), value: "" },
              { label: "Pacific/Midway (Midway Island) (Standard: UTC-11)", value: "Pacific/Midway" },
              { label: "Pacific/Honolulu (Honolulu, Hawaii) (Standard: UTC-10)", value: "Pacific/Honolulu" },
              { label: "America/Anchorage (Anchorage, Alaska) (Standard: UTC-9 / DST: UTC-8)", value: "America/Anchorage" },
              { label: "America/Los_Angeles (Pacific Time) (Standard: UTC-8 / DST: UTC-7)", value: "America/Los_Angeles" },
              { label: "America/Denver (Mountain Time) (Standard: UTC-7 / DST: UTC-6)", value: "America/Denver" },
              { label: "America/Chicago (Central Time) (Standard: UTC-6 / DST: UTC-5)", value: "America/Chicago" },
              { label: "America/New_York (Eastern Time) (Standard: UTC-5 / DST: UTC-4)", value: "America/New_York" },
              { label: "America/Halifax (Atlantic Time) (Standard: UTC-4 / DST: UTC-3)", value: "America/Halifax" },
              { label: "America/Argentina/Buenos_Aires (Buenos Aires) (Standard: UTC-3)", value: "America/Argentina/Buenos_Aires" },
              { label: "America/Noronha (Fernando de Noronha) (Standard: UTC-2)", value: "America/Noronha" },
              { label: "Atlantic/Azores (Azores) (Standard: UTC-1 / DST: UTC+0)", value: "Atlantic/Azores" },
              { label: "UTC (Coordinated Universal Time) (Standard: UTC+0)", value: "UTC" },
              { label: "Europe/London (London) (Standard: UTC+0 / DST: UTC+1)", value: "Europe/London" },
              { label: "Europe/Paris (Paris, Berlin, Rome) (Standard: UTC+1 / DST: UTC+2)", value: "Europe/Paris" },
              { label: "Europe/Kyiv (Kyiv, Helsinki, Cairo) (Standard: UTC+2 / DST: UTC+3)", value: "Europe/Kyiv" },
              { label: "Europe/Moscow (Moscow) (Standard: UTC+3)", value: "Europe/Moscow" },
              { label: "Asia/Dubai (Dubai, Baku) (Standard: UTC+4)", value: "Asia/Dubai" },
              { label: "Asia/Karachi (Karachi, Tashkent) (Standard: UTC+5)", value: "Asia/Karachi" },
              { label: "Asia/Dhaka (Dhaka, Almaty) (Standard: UTC+6)", value: "Asia/Dhaka" },
              { label: "Asia/Bangkok (Bangkok, Jakarta) (Standard: UTC+7)", value: "Asia/Bangkok" },
              { label: "Asia/Singapore (Beijing, Shanghai, Singapore) (Standard: UTC+8)", value: "Asia/Singapore" },
              { label: "Asia/Tokyo (Tokyo, Seoul) (Standard: UTC+9)", value: "Asia/Tokyo" },
              { label: "Australia/Sydney (Sydney, Melbourne) (Standard: UTC+10 / DST: UTC+11)", value: "Australia/Sydney" },
              { label: "Pacific/Noumea (Nouméa) (Standard: UTC+11)", value: "Pacific/Noumea" },
              { label: "Pacific/Auckland (Auckland, Suva) (Standard: UTC+12 / DST: UTC+13)", value: "Pacific/Auckland" },
            ]}
          />
        </FormGroup>
      </div>
    </Card>
  );
};
