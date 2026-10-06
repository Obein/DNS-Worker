import React from "react";
import { Button, FormGroup, Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { DigitInput } from "../../../../../components/DigitInput";

export interface TotpVerifyFormProps {
  totpCode: string;
  setTotpCode: React.Dispatch<React.SetStateAction<string>>;
  loading: boolean;
  onVerify: (codeValue?: string) => Promise<void>;
}

/**
 * Form for verifying identity using a 6-digit TOTP authenticator code.
 */
export const TotpVerifyForm: React.FC<TotpVerifyFormProps> = ({
  totpCode,
  setTotpCode,
  loading,
  onVerify
}) => {
  const { t } = useTranslation();

  return (
    <div className="py-2 space-y-4">
      <FormGroup label={t("account.totpCode", "Authenticator Code")}>
        <DigitInput
          length={6}
          value={totpCode}
          onChange={(val) => {
            setTotpCode(val);
            if (val.length === 6) {
              onVerify(val);
            }
          }}
          disabled={loading}
        />
      </FormGroup>
      <Button
        fill
        intent={Intent.PRIMARY}
        loading={loading}
        disabled={totpCode.length !== 6}
        onClick={() => onVerify()}
        text={t("common.confirm", "Confirm")}
      />
    </div>
  );
};
