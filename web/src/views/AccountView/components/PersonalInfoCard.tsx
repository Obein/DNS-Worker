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
  H4
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
  onUpdateUsername
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
                <InputGroup fill value={me?.username} disabled />
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
      </div>
    </Card>
  );
};
