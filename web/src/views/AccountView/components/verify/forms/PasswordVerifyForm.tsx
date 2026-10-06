import React from "react";
import { Button, FormGroup, InputGroup, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";

export interface PasswordVerifyFormProps {
  password: string;
  setPassword: React.Dispatch<React.SetStateAction<string>>;
  showPassword: boolean;
  setShowPassword: React.Dispatch<React.SetStateAction<boolean>>;
  loading: boolean;
  onSubmit: (e?: React.FormEvent) => Promise<void>;
}

/**
 * Form for verifying identity using the account password.
 */
export const PasswordVerifyForm: React.FC<PasswordVerifyFormProps> = ({
  password,
  setPassword,
  showPassword,
  setShowPassword,
  loading,
  onSubmit
}) => {
  const { t } = useTranslation();

  return (
    <form onSubmit={onSubmit} className="py-2 space-y-4">
      <FormGroup label={t("account.currentPassword", "Current Password")}>
        <InputGroup
          leftIcon="lock"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          rightElement={
            <Button
              minimal
              icon={showPassword ? "eye-open" : "eye-off"}
              onClick={() => setShowPassword(!showPassword)}
            />
          }
        />
      </FormGroup>
      <Button
        fill
        intent={Intent.PRIMARY}
        type="submit"
        loading={loading}
        text={t("common.confirm", "Confirm")}
      />
    </form>
  );
};
