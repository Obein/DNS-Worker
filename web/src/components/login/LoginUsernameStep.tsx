import React from "react";
import { FormGroup, InputGroup, Button, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

/**
 * Properties for the LoginUsernameStep component.
 */
export interface LoginUsernameStepProps {
  /** The current username value. */
  username: string;
  /** Callback to update the username value. */
  setUsername: (val: string) => void;
  /** Flag showing if Turnstile verification is enabled. */
  isTurnstileEnabled: boolean | undefined;
  /** Ref pointing to the Turnstile container div. */
  turnstileRef: React.RefObject<HTMLDivElement | null>;
  /** Indicates if prelogin check is loading. */
  loading: boolean;
  /** The current state of Turnstile verification. */
  turnstileStatus: "idle" | "verifying" | "success" | "error";
  /** Callback to handle form submission. */
  onSubmit: (e: React.FormEvent) => void;
}

/**
 * LoginUsernameStep is the first step of the login flow.
 * It takes the username and runs Turnstile verification.
 *
 * @param props - Component props.
 * @returns React element representing login username form step.
 */
export const LoginUsernameStep: React.FC<LoginUsernameStepProps> = ({
  username,
  setUsername,
  isTurnstileEnabled,
  turnstileRef,
  loading,
  turnstileStatus,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <FormGroup label={t("auth.username")} labelFor="username">
        <InputGroup
          id="username"
          leftIcon="user"
          placeholder={t("auth.usernamePlaceholder")}
          size="large"
          className="rounded-xl w-full"
          value={username}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setUsername(e.target.value)
          }
          required
        />
      </FormGroup>

      {isTurnstileEnabled && (
        <div className="py-2 flex justify-center min-h-16.25">
          <div ref={turnstileRef} />
        </div>
      )}

      <Button
        fill
        size="large"
        intent={Intent.PRIMARY}
        type="submit"
        loading={loading || turnstileStatus === "verifying"}
        disabled={
          !!isTurnstileEnabled && turnstileStatus !== "success"
        }
        className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20"
      >
        {turnstileStatus === "verifying"
          ? t("auth.verifying")
          : t("auth.next", "Next")}
      </Button>
    </form>
  );
};
