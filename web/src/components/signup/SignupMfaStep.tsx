import React from "react";
import {
  Button,
  FormGroup,
  Callout,
  Intent,
  Card,
  Elevation,
  Tag
} from "@blueprintjs/core";
import { Fingerprint, Smartphone, ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { QRCodeCanvas } from "../../views/AccountView/components/QRCodeCanvas";
import { DigitInput } from "../DigitInput";

export interface SignupMfaStepProps {
  mfaChoice: "choose" | "totp";
  setMfaChoice: (choice: "choose" | "totp") => void;
  onRegisterPasskey: () => void;
  passkeyRegLoading: boolean;
  passkeyRegError: string;
  onStartTotp: () => void;
  totpSetupData: { secret: string; uri: string } | null;
  totpSetupToken: string;
  setTotpSetupToken: (val: string) => void;
  totpSetupError: string;
  totpSetupLoading: boolean;
  onTotpSubmit: (e: React.FormEvent) => void;
  onSkip: () => void;
}

export const SignupMfaStep: React.FC<SignupMfaStepProps> = ({
  mfaChoice,
  setMfaChoice,
  onRegisterPasskey,
  passkeyRegLoading,
  passkeyRegError,
  onStartTotp,
  totpSetupData,
  totpSetupToken,
  setTotpSetupToken,
  totpSetupError,
  totpSetupLoading,
  onTotpSubmit,
  onSkip
}) => {
  const { t } = useTranslation();

  // Mode 1: Choice view (Passkey vs TOTP)
  if (mfaChoice === "choose") {
    return (
      <div className="space-y-4">
        {passkeyRegError && (
          <Callout intent={Intent.DANGER} className="rounded-xl">
            {passkeyRegError}
          </Callout>
        )}

        <div className="space-y-3">
          {/* Passkey Card */}
          <Card
            elevation={Elevation.ONE}
            className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/40 hover:border-blue-300 dark:hover:border-blue-700 transition-colors cursor-pointer"
            onClick={!passkeyRegLoading ? onRegisterPasskey : undefined}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-xl">
                  <Fingerprint size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 m-0">
                      {t("account.passkey.title", "通行密钥 (Passkey)")}
                    </h4>
                    <Tag intent={Intent.PRIMARY} minimal round>
                      {t("auth.mfaRecommended", "推荐 · 无密码")}
                    </Tag>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-0 leading-relaxed">
                    {t(
                      "auth.passkeySignupDesc",
                      "使用本设备生物识别 (Touch ID / Face ID / Windows Hello) 或硬件密钥 (YubiKey)，一键快捷且防钓鱼。"
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 text-right">
              <Button
                intent={Intent.PRIMARY}
                loading={passkeyRegLoading}
                text={t("auth.bindPasskeyNow", "绑定通行密钥")}
                className="rounded-lg font-medium"
              />
            </div>
          </Card>

          {/* TOTP Card */}
          <Card
            elevation={Elevation.ONE}
            className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-gray-300 dark:hover:border-gray-700 transition-colors cursor-pointer"
            onClick={onStartTotp}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 rounded-xl">
                  <Smartphone size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-gray-800 dark:text-gray-100 m-0">
                      {t("auth.mfaMethodTotp", "数字验证器 (TOTP)")}
                    </h4>
                    <Tag intent={Intent.NONE} minimal round>
                      {t("auth.mfaUniversal", "通用应用")}
                    </Tag>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-0 leading-relaxed">
                    {t(
                      "account.totp.setupDesc",
                      "使用 Google Authenticator、1Password 等验证器应用扫码绑定 6 位动态验证码。"
                    )}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-3 text-right">
              <Button
                minimal
                text={t("auth.setupTotpBtn", "扫码配置验证器")}
                className="rounded-lg font-medium text-gray-700 dark:text-gray-200"
              />
            </div>
          </Card>
        </div>

        <div className="text-center pt-2">
          <Button
            minimal
            text={t("auth.skipMfaSetup", "跳过多因素认证配置，直接进入系统")}
            onClick={onSkip}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          />
        </div>
      </div>
    );
  }

  // Mode 2: TOTP Setup view
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMfaChoice("choose")}
          className="text-xs text-blue-600 hover:underline flex items-center gap-1 bg-transparent border-none cursor-pointer p-0"
        >
          <ArrowLeft size={14} />
          <span>{t("auth.backToMfaOptions", "选择其他认证方式")}</span>
        </button>
      </div>

      {totpSetupData && (
        <div className="flex flex-col items-center gap-3">
          <QRCodeCanvas uri={totpSetupData.uri} />
          <div className="text-center">
            <p className="text-xs text-gray-500 mb-1">
              {t("account.totp.orEnterManually", "Or enter the key manually:")}
            </p>
            <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">
              {totpSetupData.secret}
            </code>
          </div>
        </div>
      )}

      {totpSetupError && (
        <Callout intent={Intent.DANGER} className="rounded-xl">
          {totpSetupError}
        </Callout>
      )}

      <form onSubmit={onTotpSubmit} className="space-y-4">
        <FormGroup
          label={t("account.totp.enterCode", "Enter the 6-digit code:")}
          helperText={t(
            "account.totp.enterCodeHint",
            "Enter the 6-digit code to confirm."
          )}
        >
          <DigitInput
            length={6}
            value={totpSetupToken}
            onChange={setTotpSetupToken}
            disabled={totpSetupLoading}
            autoFocus
          />
        </FormGroup>

        <Button
          fill
          size="large"
          intent={Intent.PRIMARY}
          type="submit"
          loading={totpSetupLoading}
          disabled={totpSetupToken.length !== 6}
          className="rounded-xl font-bold py-3"
        >
          {t("account.totp.activate", "Activate")}
        </Button>
      </form>
    </div>
  );
};
