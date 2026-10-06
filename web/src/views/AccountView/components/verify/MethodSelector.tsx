import React from "react";
import { Button, ButtonGroup, Intent } from "@blueprintjs/core";
import { Key, Lock, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";

export type AuthMethod = "password" | "passkey" | "totp" | "recovery_key";

export interface MethodSelectorProps {
  method: AuthMethod;
  onSelectMethod: (method: AuthMethod) => void;
  hasPasskey: boolean;
  hasRecoveryKey: boolean;
  hasTotp: boolean;
  hasPassword: boolean;
}

/**
 * Pill button group for switching between verification methods (Passkey, Recovery Key, TOTP, Password).
 */
export const MethodSelector: React.FC<MethodSelectorProps> = ({
  method,
  onSelectMethod,
  hasPasskey,
  hasRecoveryKey,
  hasTotp,
  hasPassword
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex justify-center mb-5 isolate" style={{ isolation: "isolate" }}>
      <div className="w-full bg-gray-100/70 dark:bg-gray-800/70 p-1 rounded-lg">
        <ButtonGroup fill variant="minimal" style={{ isolation: "isolate" }}>
          {hasPasskey && (
            <Button
              small
              active={method === "passkey"}
              intent={method === "passkey" ? Intent.PRIMARY : Intent.NONE}
              icon={<Key size={14} />}
              text={t("account.mfa.passkey", "Passkey")}
              onClick={() => onSelectMethod("passkey")}
            />
          )}
          {hasRecoveryKey && (
            <Button
              small
              active={method === "recovery_key"}
              intent={method === "recovery_key" ? Intent.PRIMARY : Intent.NONE}
              icon={<Key size={14} />}
              text={t("account.recoveryKey.verifyBtn", "Recovery Key")}
              onClick={() => onSelectMethod("recovery_key")}
            />
          )}
          {hasTotp && (
            <Button
              small
              active={method === "totp"}
              intent={method === "totp" ? Intent.PRIMARY : Intent.NONE}
              icon={<ShieldCheck size={14} />}
              text={t("account.mfa.totp", "TOTP")}
              onClick={() => onSelectMethod("totp")}
            />
          )}
          {hasPassword && (
            <Button
              small
              active={method === "password"}
              intent={method === "password" ? Intent.PRIMARY : Intent.NONE}
              icon={<Lock size={14} />}
              text={t("account.mfa.password", "Password")}
              onClick={() => onSelectMethod("password")}
            />
          )}
        </ButtonGroup>
      </div>
    </div>
  );
};
