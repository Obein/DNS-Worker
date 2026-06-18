import React from "react";
import {
  Button,
  FormGroup,
  InputGroup,
  Tooltip,
  Position,
  Intent
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

/**
 * Properties for the SignupUsernameStep component.
 */
export interface SignupUsernameStepProps {
  /** The current username value. */
  username: string;
  /** Callback to update the username value. */
  setUsername: (val: string) => void;
  /** State indicating if username input field has focus. */
  usernameFocused: boolean;
  /** Callback to set focus state of username input. */
  setUsernameFocused: (focused: boolean) => void;
  /** Callback to check username availability on backend. */
  checkUsernameDuplicate: (uname: string) => void;
  /** Indicates if signup username submission is loading. */
  loading: boolean;
  /** Callback to handle form submission. */
  onSubmit: (e: React.FormEvent) => void;
  /** Callback to reset or clear username specific errors. */
  onClearError: () => void;
}

/**
 * SignupUsernameStep is the first step of the signup wizard.
 * It handles username input, real-time availability checks, and CAPTCHA challenge.
 *
 * @param props - Component props.
 * @returns React element representing username step.
 */
export const SignupUsernameStep: React.FC<SignupUsernameStepProps> = ({
  username,
  setUsername,
  usernameFocused,
  setUsernameFocused,
  checkUsernameDuplicate,
  loading,
  onSubmit,
  onClearError
}) => {
  const { t } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormGroup label={t("auth.username")} labelFor="username">
        <Tooltip
          content={t("auth.formatTipUsername")}
          isOpen={usernameFocused}
          position={Position.TOP}
          intent={Intent.PRIMARY}
          className="w-full"
        >
          <div className="w-full block">
            <InputGroup
              id="username"
              leftIcon="user"
              placeholder={t("auth.usernamePlaceholder")}
              size="large"
              className="rounded-xl w-full"
              value={username}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                setUsername(e.target.value);
                onClearError();
              }}
              onFocus={() => setUsernameFocused(true)}
              onBlur={() => {
                setUsernameFocused(false);
                checkUsernameDuplicate(username);
              }}
              autoFocus
              required
            />
          </div>
        </Tooltip>
      </FormGroup>

      <Button
        fill
        size="large"
        intent={Intent.PRIMARY}
        type="submit"
        loading={loading}
        className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
      >
        {t("auth.next", "Next")}
      </Button>
    </form>
  );
};
