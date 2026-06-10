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
 * Properties for the SignupPasswordStep component.
 */
export interface SignupPasswordStepProps {
  /** The current password value. */
  password: string;
  /** Callback to update the password value. */
  setPassword: (val: string) => void;
  /** State indicating if password input field has focus. */
  passwordFocused: boolean;
  /** Callback to set focus state of password input. */
  setPasswordFocused: (focused: boolean) => void;
  /** Indicates if signup submission is loading. */
  loading: boolean;
  /** Callback to handle form submission. */
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * SignupPasswordStep is the second step of the signup wizard.
 * It handles password complexity validation and registration submission.
 *
 * @param props - Component props.
 * @returns React element representing password step.
 */
export const SignupPasswordStep: React.FC<SignupPasswordStepProps> = ({
  password,
  setPassword,
  passwordFocused,
  setPasswordFocused,
  loading,
  onSubmit
}) => {
  const { t } = useTranslation();

  /**
   * Renders a clear button inside the password input group.
   *
   * @returns React element or undefined.
   */
  const renderPasswordClearButton = (): React.JSX.Element | undefined => {
    if (!password) return undefined;
    return (
      <Button
        minimal={true}
        icon="cross"
        onClick={() => setPassword("")}
      />
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormGroup label={t("auth.password")} labelFor="password">
        <Tooltip
          content={t("auth.formatTipPassword")}
          isOpen={passwordFocused}
          position={Position.TOP}
          intent={Intent.PRIMARY}
          className="w-full"
        >
          <div className="w-full block">
            <InputGroup
              id="password"
              leftIcon="lock"
              placeholder={t("auth.passwordPlaceholder")}
              type="password"
              size="large"
              className="rounded-xl w-full"
              value={password}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setPassword(e.target.value)
              }
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              rightElement={renderPasswordClearButton()}
              required
              autoFocus
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
        {t("auth.signupBtn")}
      </Button>
    </form>
  );
};
