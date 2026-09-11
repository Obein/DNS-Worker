import React from "react";
import { FormGroup, InputGroup, Button, Intent, Checkbox } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

/**
 * Properties for the LoginPasswordStep component.
 */
export interface LoginPasswordStepProps {
  /** Current password input value. */
  password: string;
  /** Callback to update password value. */
  setPassword: (val: string) => void;
  /** True if user has any MFA configured (Passkey or TOTP). */
  hasMfa: boolean;
  /** Callback to switch directly to MFA step via "Other options". */
  onSwitchToMfa?: () => void;
  /** Indicates if submission is actively in progress. */
  loading: boolean;
  /** Callback to handle form submission. */
  onSubmit: (e: React.FormEvent) => void;
  /** Whether the user wants to stay logged in. */
  keepLoggedIn: boolean;
  /** Callback to toggle stay logged in. */
  setKeepLoggedIn: (val: boolean) => void;
  /** Optional session expiration duration in days. */
  optionalSessionExpirationDays: number;
}

/**
 * LoginPasswordStep renders the password input step.
 * If the user has MFA configured, an "Other options" button is provided
 * to switch to MFA verification directly without requiring password entry.
 */
export const LoginPasswordStep: React.FC<LoginPasswordStepProps> = ({
  password,
  setPassword,
  hasMfa,
  onSwitchToMfa,
  loading,
  onSubmit,
  keepLoggedIn,
  setKeepLoggedIn,
  optionalSessionExpirationDays
}) => {
  const [showPassword, setShowPassword] = React.useState(false);
  const { t } = useTranslation();

  const renderPasswordRightElement = (): React.JSX.Element => {
    return (
      <div className="flex items-center">
        {password && (
          <Button
            minimal={true}
            icon="cross"
            onClick={() => setPassword("")}
          />
        )}
        <Button
          minimal={true}
          icon={showPassword ? "eye-open" : "eye-off"}
          onClick={() => setShowPassword(!showPassword)}
          title={showPassword ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
        />
      </div>
    );
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormGroup label={t("auth.password")} labelFor="password">
        <InputGroup
          id="password"
          leftIcon="lock"
          placeholder={t("auth.passwordPlaceholder")}
          type={showPassword ? "text" : "password"}
          size="large"
          className="rounded-xl"
          value={password}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPassword(e.target.value)
          }
          rightElement={renderPasswordRightElement()}
          autoFocus
          required
        />
      </FormGroup>

      <Checkbox
        checked={keepLoggedIn}
        onChange={(e) => setKeepLoggedIn(e.currentTarget.checked)}
        label={t("auth.keepLoggedIn", "Keep me logged in for {{days}} days", {
          days: optionalSessionExpirationDays
        })}
        className="mt-4 text-left"
      />

      <div className="pt-2 space-y-3">
        <Button
          fill
          size="large"
          intent={Intent.PRIMARY}
          type="submit"
          loading={loading}
          className="font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
        >
          {hasMfa ? t("auth.next", "Next") : t("auth.loginBtn", "Login")}
        </Button>

        {hasMfa && onSwitchToMfa && (
          <Button
            fill
            minimal
            size="large"
            type="button"
            disabled={loading}
            onClick={onSwitchToMfa}
            className="font-medium text-blue-600 dark:text-blue-400 py-2.5 rounded-xl transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/30"
          >
            {t("auth.otherOptions", "其他选项")}
          </Button>
        )}
      </div>
    </form>
  );
};
