import React from "react";
import { Intent } from "@blueprintjs/core";
import {
  LogIn,
  AlertTriangle,
  LogOut,
  ShieldCheck,
  Shield,
  ShieldOff,
  UserPlus,
  Key
} from "lucide-react";

export const ACTION_META: Record<
  string,
  { label: string; icon: React.ReactNode; intent: Intent }
> = {
  signup: {
    label: "account.activity.signup",
    icon: <UserPlus size={14} />,
    intent: Intent.SUCCESS,
  },
  login_success: {
    label: "account.activity.loginSuccess",
    icon: <LogIn size={14} />,
    intent: Intent.SUCCESS,
  },
  login_fail: {
    label: "account.activity.loginFail",
    icon: <AlertTriangle size={14} />,
    intent: Intent.DANGER,
  },
  logout: {
    label: "account.activity.logout",
    icon: <LogOut size={14} />,
    intent: Intent.NONE,
  },
  password_change_success: {
    label: "account.activity.pwChangeSuccess",
    icon: <Key size={14} />,
    intent: Intent.SUCCESS,
  },
  password_change_fail: {
    label: "account.activity.pwChangeFail",
    icon: <AlertTriangle size={14} />,
    intent: Intent.DANGER,
  },
  totp_verify_success: {
    label: "account.activity.totpVerifySuccess",
    icon: <ShieldCheck size={14} />,
    intent: Intent.SUCCESS,
  },
  totp_verify_fail: {
    label: "account.activity.totpVerifyFail",
    icon: <AlertTriangle size={14} />,
    intent: Intent.DANGER,
  },
  totp_setup: {
    label: "account.activity.totpSetup",
    icon: <Shield size={14} />,
    intent: Intent.PRIMARY,
  },
  totp_removed: {
    label: "account.activity.totpRemoved",
    icon: <ShieldOff size={14} />,
    intent: Intent.WARNING,
  },
  recovery_key_used: {
    label: "account.activity.recoveryKeyUsed",
    icon: <Key size={14} />,
    intent: Intent.WARNING,
  },
  session_revoked: {
    label: "account.activity.sessionRevoked",
    icon: <LogOut size={14} />,
    intent: Intent.WARNING,
  },
  passkey_registered: {
    label: "account.activity.passkeyRegistered",
    icon: <Key size={14} />,
    intent: Intent.PRIMARY,
  },
  passkey_deleted: {
    label: "account.activity.passkeyDeleted",
    icon: <ShieldOff size={14} />,
    intent: Intent.WARNING,
  },
  passkey_verify_success: {
    label: "account.activity.passkeyVerifySuccess",
    icon: <ShieldCheck size={14} />,
    intent: Intent.SUCCESS,
  },
  passkey_verify_fail: {
    label: "account.activity.passkeyVerifyFail",
    icon: <AlertTriangle size={14} />,
    intent: Intent.DANGER,
  },
};
