import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Card,
  Elevation,
  FormGroup,
  InputGroup,
  Button,
  H4,
  Intent,
  Tag,
  HTMLTable,
  Callout,
  Divider,
  Dialog,
  HTMLSelect,
  ButtonGroup,
  Switch,
  Spinner,
} from "@blueprintjs/core";
import {
  User, ShieldCheck, Trash2, UserPlus, Key, Edit2, Check, X, Settings,
  Shield, Activity, LogIn, LogOut, AlertTriangle, RefreshCw, Copy,
  Smartphone, ShieldOff, ChevronDown, ShieldAlert
} from "lucide-react";
import { useTranslation } from "react-i18next";

export interface UserInfo {
  id: string;
  username: string;
  role: 'admin' | 'user';
  created_at?: number;
  totp_enabled?: boolean;
  totp_skip_password?: boolean;
}

interface ActivityEntry {
  id: number;
  action: string;
  ip_address: string | null;
  user_agent: string | null;
  timestamp: number;
  extra: string | null;
}

// Map action codes to display icon + intent
const ACTION_META: Record<string, { label: string; icon: React.ReactNode; intent: Intent }> = {
  login_success:          { label: "account.activity.loginSuccess",       icon: <LogIn size={14} />,       intent: Intent.SUCCESS },
  login_fail:             { label: "account.activity.loginFail",          icon: <AlertTriangle size={14} />, intent: Intent.DANGER },
  logout:                 { label: "account.activity.logout",             icon: <LogOut size={14} />,      intent: Intent.NONE },
  password_change_success:{ label: "account.activity.pwChangeSuccess",   icon: <Key size={14} />,         intent: Intent.SUCCESS },
  password_change_fail:   { label: "account.activity.pwChangeFail",      icon: <AlertTriangle size={14} />, intent: Intent.DANGER },
  totp_verify_success:    { label: "account.activity.totpVerifySuccess", icon: <ShieldCheck size={14} />, intent: Intent.SUCCESS },
  totp_verify_fail:       { label: "account.activity.totpVerifyFail",    icon: <AlertTriangle size={14} />, intent: Intent.DANGER },
  totp_setup:             { label: "account.activity.totpSetup",         icon: <Shield size={14} />,      intent: Intent.PRIMARY },
  totp_removed:           { label: "account.activity.totpRemoved",       icon: <ShieldOff size={14} />,   intent: Intent.WARNING },
  recovery_key_used:      { label: "account.activity.recoveryKeyUsed",   icon: <Key size={14} />,         intent: Intent.WARNING },
};

// ─── QR Code generator (inline canvas, no external dep at runtime) ──────────

/**
 * Renders a QR code for a given otpauth URI using the `qrcode` package.
 * Dynamically imports to keep bundle small.
 */
const QRCodeCanvas: React.FC<{ uri: string }> = ({ uri }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !uri) return;
    import('qrcode').then(QRCode => {
      QRCode.toCanvas(canvasRef.current!, uri, { width: 200, margin: 2, color: { dark: '#1a1a2e', light: '#ffffff' } }, (err) => {
        if (err) { console.error(err); setError(true); }
      });
    }).catch(() => setError(true));
  }, [uri]);

  if (error) {
    return (
      <div className="w-[200px] h-[200px] border border-gray-200 rounded-lg flex flex-col items-center justify-center text-center p-4 text-xs text-gray-500">
        <p className="break-all">{uri}</p>
      </div>
    );
  }
  return <canvas ref={canvasRef} className="rounded-lg border border-gray-100" />;
};

// ─── TOTP Management Card ─────────────────────────────────────────────────────

interface TOTPCardProps {
  user: UserInfo;
  onRefresh: () => void;
  clientIp?: string;
}

const TOTPCard: React.FC<TOTPCardProps> = ({ user, onRefresh }) => {
  const { t } = useTranslation();

  // Setup flow state
  const [setupData, setSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [setupToken, setSetupToken] = useState("");
  const [recoveryKeys, setRecoveryKeys] = useState<string[] | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState("");
  const [copied, setCopied] = useState(false);

  // Disable flow state
  const [disableDialogOpen, setDisableDialogOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableLoading, setDisableLoading] = useState(false);
  const [disableError, setDisableError] = useState("");

  // Settings
  const [settingsLoading, setSettingsLoading] = useState(false);

  const handleStartSetup = async () => {
    setSetupLoading(true);
    setSetupError("");
    try {
      const res = await fetch("/api/account/totp/setup");
      if (res.ok) {
        setSetupData(await res.json());
      } else {
        setSetupError(await res.text());
      }
    } catch { setSetupError(t("common.errorNetwork")); }
    finally { setSetupLoading(false); }
  };

  const handleConfirmSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!setupData) return;
    setSetupLoading(true);
    setSetupError("");
    try {
      const res = await fetch("/api/account/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: setupData.secret, token: setupToken.replace(/\s/g, "") }),
      });
      if (res.ok) {
        const data = await res.json();
        setRecoveryKeys(data.recovery_keys);
        setSetupData(null);
        setSetupToken("");
        onRefresh();
      } else {
        setSetupError(await res.text());
      }
    } catch { setSetupError(t("common.errorNetwork")); }
    finally { setSetupLoading(false); }
  };

  const handleCopyRecoveryKeys = () => {
    if (!recoveryKeys) return;
    navigator.clipboard.writeText(recoveryKeys.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDisable = async (e: React.FormEvent) => {
    e.preventDefault();
    setDisableLoading(true);
    setDisableError("");
    try {
      const res = await fetch("/api/account/totp", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      if (res.ok) {
        setDisableDialogOpen(false);
        setDisablePassword("");
        onRefresh();
      } else {
        setDisableError(await res.text());
      }
    } catch { setDisableError(t("common.errorNetwork")); }
    finally { setDisableLoading(false); }
  };

  const handleToggleSkipPassword = async (val: boolean) => {
    setSettingsLoading(true);
    try {
      await fetch("/api/account/totp/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skip_password: val }),
      });
      onRefresh();
    } catch { /* ignore */ }
    finally { setSettingsLoading(false); }
  };

  // Phase: show recovery keys after setup
  if (recoveryKeys) {
    return (
      <Card elevation={Elevation.ONE}>
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={20} className="text-green-500" />
          <H4 style={{ margin: 0 }}>{t("account.totp.recoveryKeysTitle", "Save Your Recovery Keys")}</H4>
        </div>
        <Callout intent={Intent.WARNING} className="mb-4">
          {t("account.totp.recoveryKeysWarning", "Store these keys safely. Each key can only be used once. You will NOT see them again.")}
        </Callout>
        <div className="grid grid-cols-2 gap-2 mb-4">
          {recoveryKeys.map((key, i) => (
            <code key={i} className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded text-center tracking-wider">
              {key}
            </code>
          ))}
        </div>
        <div className="flex gap-2">
          <Button fill icon={<Copy size={14} />} text={copied ? t("account.totp.copied", "Copied!") : t("account.totp.copyKeys", "Copy All Keys")} intent={copied ? Intent.SUCCESS : Intent.NONE} onClick={handleCopyRecoveryKeys} />
          <Button fill intent={Intent.PRIMARY} text={t("account.totp.done", "Done, I've saved them")} onClick={() => setRecoveryKeys(null)} />
        </div>
      </Card>
    );
  }

  // Phase: TOTP enabled — show settings
  if (user.totp_enabled) {
    return (
      <Card elevation={Elevation.ONE}>
        <div className="flex items-center gap-2 mb-4">
          <Shield size={20} className="text-green-500" />
          <H4 style={{ margin: 0 }}>{t("account.totp.title", "Two-Factor Authentication")}</H4>
          <Tag intent={Intent.SUCCESS} minimal round>{t("account.totp.enabled", "Enabled")}</Tag>
        </div>
        <div className="space-y-4">
          <Switch
            label={t("account.totp.skipPassword", "Passwordless login (TOTP only — hide password field)")}
            checked={!!user.totp_skip_password}
            onChange={(e) => handleToggleSkipPassword(e.currentTarget.checked)}
            disabled={settingsLoading}
          />
          <Divider />
          <Button
            intent={Intent.DANGER}
            outlined
            icon={<ShieldOff size={14} />}
            text={t("account.totp.disable", "Disable Two-Factor Authentication")}
            onClick={() => setDisableDialogOpen(true)}
          />
        </div>

        <Dialog isOpen={disableDialogOpen} onClose={() => { setDisableDialogOpen(false); setDisablePassword(""); setDisableError(""); }} title={t("account.totp.disableTitle", "Disable 2FA")} icon="shield">
          <div className="p-6 space-y-4">
            <Callout intent={Intent.WARNING}>{t("account.totp.disableWarning", "After disabling 2FA, your account will only be protected by password.")}</Callout>
            {disableError && <Callout intent={Intent.DANGER}>{disableError}</Callout>}
            {!user.totp_skip_password && (
              <form onSubmit={handleDisable} className="space-y-4">
                <FormGroup label={t("account.currentPassword")}>
                  <InputGroup type="password" leftIcon="lock" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} required />
                </FormGroup>
                <div className="flex justify-end gap-2">
                  <Button text={t("account.cancel")} onClick={() => setDisableDialogOpen(false)} />
                  <Button intent={Intent.DANGER} text={t("account.totp.confirmDisable", "Disable 2FA")} type="submit" loading={disableLoading} />
                </div>
              </form>
            )}
            {user.totp_skip_password && (
              <div className="flex justify-end gap-2">
                <Button text={t("account.cancel")} onClick={() => setDisableDialogOpen(false)} />
                <Button intent={Intent.DANGER} text={t("account.totp.confirmDisable", "Disable 2FA")} loading={disableLoading} onClick={(e) => handleDisable(e as any)} />
              </div>
            )}
          </div>
        </Dialog>
      </Card>
    );
  }

  // Phase: TOTP not yet enabled — show setup or QR/confirm
  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center gap-2 mb-4">
        <Smartphone size={20} className="text-blue-500" />
        <H4 style={{ margin: 0 }}>{t("account.totp.title", "Two-Factor Authentication")}</H4>
        <Tag minimal round intent={Intent.NONE}>{t("account.totp.disabled", "Disabled")}</Tag>
      </div>

      {!setupData ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t("account.totp.setupDesc", "Add an extra layer of security. Use Google Authenticator, Authy, or any TOTP app.")}
          </p>
          {setupError && <Callout intent={Intent.DANGER}>{setupError}</Callout>}
          <Button intent={Intent.PRIMARY} icon={<Shield size={14} />} text={t("account.totp.setupBtn", "Enable Two-Factor Authentication")} loading={setupLoading} onClick={handleStartSetup} />
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm font-medium">{t("account.totp.scanQR", "Scan this QR code with your authenticator app:")}</p>
          <div className="flex flex-col items-center gap-3">
            <QRCodeCanvas uri={setupData.uri} />
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">{t("account.totp.orEnterManually", "Or enter the key manually:")}</p>
              <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">{setupData.secret}</code>
            </div>
          </div>
          <Divider />
          {setupError && <Callout intent={Intent.DANGER}>{setupError}</Callout>}
          <form onSubmit={handleConfirmSetup} className="space-y-3">
            <FormGroup label={t("account.totp.enterCode", "Enter the 6-digit code to confirm:")} helperText={t("account.totp.enterCodeHint", "This verifies the key was scanned correctly.")}>
              <InputGroup
                id="totp-setup-token"
                placeholder="000000"
                value={setupToken}
                onChange={(e) => setSetupToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                maxLength={6}
                inputMode="numeric"
                className="font-mono tracking-widest"
                required
              />
            </FormGroup>
            <div className="flex gap-2">
              <Button text={t("account.cancel")} onClick={() => { setSetupData(null); setSetupToken(""); setSetupError(""); }} />
              <Button intent={Intent.SUCCESS} type="submit" loading={setupLoading} text={t("account.totp.activate", "Activate")} disabled={setupToken.length < 6} />
            </div>
          </form>
        </div>
      )}
    </Card>
  );
};

// ─── Activity Log Card ────────────────────────────────────────────────────────

const ActivityLogCard: React.FC = () => {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [expanded, setExpanded] = useState(false);

  const fetchActivity = useCallback(async (before?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: "20" });
      if (before) params.set("before", String(before));
      const res = await fetch(`/api/account/activity?${params}`);
      if (res.ok) {
        const data: ActivityEntry[] = await res.json();
        if (before) {
          setEntries(prev => [...prev, ...data]);
        } else {
          setEntries(data);
        }
        setHasMore(data.length === 20);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchActivity(); }, [fetchActivity]);

  const handleLoadMore = () => {
    const last = entries[entries.length - 1];
    if (last) fetchActivity(last.timestamp);
  };

  const getActionMeta = (action: string) => ACTION_META[action] ?? {
    label: action,
    icon: <Activity size={14} />,
    intent: Intent.NONE,
  };

  return (
    <Card elevation={Elevation.ONE}>
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <Activity size={20} className="text-purple-500" />
          <H4 style={{ margin: 0 }}>{t("account.activity.title", "Account Activity")}</H4>
          {entries.length > 0 && (
            <Tag minimal round intent={Intent.NONE}>{entries.length}{hasMore ? "+" : ""}</Tag>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button minimal icon={<RefreshCw size={14} />} onClick={(e) => { e.stopPropagation(); fetchActivity(); }} />
          <ChevronDown size={16} className={`text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </div>

      {expanded && (
        <div className="mt-4">
          {loading && entries.length === 0 ? (
            <div className="flex justify-center py-8"><Spinner size={24} /></div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">{t("account.activity.empty", "No activity recorded yet.")}</p>
          ) : (
            <div className="overflow-x-auto">
              <HTMLTable interactive striped className="w-full text-sm">
                <thead>
                  <tr>
                    <th>{t("account.activity.action", "Action")}</th>
                    <th>{t("account.activity.time", "Time")}</th>
                    <th>{t("account.activity.ip", "IP Address")}</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const meta = getActionMeta(entry.action);
                    return (
                      <tr key={entry.id}>
                        <td>
                          <Tag minimal intent={meta.intent} icon={meta.icon as any}>
                            {t(meta.label, entry.action)}
                          </Tag>
                        </td>
                        <td className="text-xs text-gray-500 whitespace-nowrap">
                          {new Date(entry.timestamp * 1000).toLocaleString()}
                        </td>
                        <td className="font-mono text-xs text-gray-500">
                          {entry.ip_address || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </HTMLTable>
              {hasMore && (
                <div className="flex justify-center mt-3">
                  <Button minimal loading={loading} text={t("account.activity.loadMore", "Load More")} onClick={handleLoadMore} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

// ─── Main Account View ────────────────────────────────────────────────────────

export const AccountView: React.FC = () => {
  const [me, setMe] = useState<UserInfo | null>(null);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const { t } = useTranslation();

  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [editUsername, setEditUsername] = useState("");
  const [usernameLoading, setUsernameLoading] = useState(false);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [useTotpForPw, setUseTotpForPw] = useState(false);
  const [totpToken, setTotpToken] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ text: string; intent: Intent } | null>(null);

  const [sysSettings, setSysSettings] = useState<Record<string, string>>({});
  const [sysLoading, setSysLoading] = useState(false);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [createLoading, setCreateLoading] = useState(false);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/account/me");
      if (res.ok) {
        const data = await res.json();
        setMe(data);
        setEditUsername(data.username);
        if (data.role === 'admin') {
          fetchUsers();
          fetchSystemSettings();
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) setUsers(await res.json());
    } catch (e) { console.error(e); }
  };

  const fetchSystemSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) setSysSettings(await res.json());
    } catch (e) { console.error(e); }
  };

  const handleUpdateUsername = async () => {
    if (editUsername === me?.username) { setIsEditingUsername(false); return; }
    if (!/^[a-zA-Z0-9]{5,15}$/.test(editUsername)) { alert(t("account.formatErrorUsername")); return; }
    setUsernameLoading(true);
    try {
      const res = await fetch("/api/account/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: editUsername }),
      });
      if (res.ok) { setMe(prev => prev ? { ...prev, username: editUsername } : null); setIsEditingUsername(false); }
      else { alert(await res.text()); }
    } catch (e) { console.error(e); }
    finally { setUsernameLoading(false); }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8 || !/(?=.*[a-zA-Z])(?=.*[0-9])/.test(newPassword)) {
      setPwMessage({ text: t("account.formatErrorPassword"), intent: Intent.DANGER });
      return;
    }
    setPwLoading(true);
    setPwMessage(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          oldPassword: useTotpForPw ? undefined : oldPassword, 
          totpToken: useTotpForPw ? totpToken : undefined, 
          newPassword 
        }),
      });
      if (res.ok) {
        setPwMessage({ text: t("account.passwordSuccess"), intent: Intent.SUCCESS });
        setOldPassword(""); setNewPassword("");
      } else {
        const msg = await res.text();
        setPwMessage({ text: msg || t("account.updateFailed"), intent: Intent.DANGER });
      }
    } catch (e) {
      setPwMessage({ text: t("common.errorNetwork"), intent: Intent.DANGER });
    } finally { setPwLoading(false); }
  };

  const handleSaveSysSettings = async () => {
    setSysLoading(true);
    try {
      await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sysSettings),
      });
      alert(t("common.saveSuccess", "Settings saved"));
    } catch (e) { console.error(e); }
    finally { setSysLoading(false); }
  };

  const handleCreateUser = async () => {
    if (!/^[a-zA-Z0-9]{5,15}$/.test(newUsername)) { alert(t("account.formatErrorUsername")); return; }
    if (newUserPassword.length < 8 || !/(?=.*[a-zA-Z])(?=.*[0-9])/.test(newUserPassword)) { alert(t("account.formatErrorPassword")); return; }
    setCreateLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newUserPassword, role: newUserRole }),
      });
      if (res.ok) { setIsDialogOpen(false); setNewUsername(""); setNewUserPassword(""); fetchUsers(); }
      else { alert(await res.text()); }
    } catch (e) { console.error(e); }
    finally { setCreateLoading(false); }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm(t("account.confirmDeleteUser"))) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (res.ok) fetchUsers();
    } catch (e) { console.error(e); }
  };

  const handleClearAllLogs = async () => {
    if (!confirm(t("account.confirmClearLogs"))) return;
    try {
      const res = await fetch("/api/account/logs", { method: "DELETE" });
      if (res.ok) alert(t("account.clearLogsSuccess"));
    } catch (e) { console.error(e); }
  };

  const handleDeleteMyAccount = async () => {
    if (!confirm(t("account.confirmDeleteAccount"))) return;
    try {
      const res = await fetch("/api/account/me", { method: "DELETE" });
      if (res.ok) { window.location.href = "/"; }
      else { alert(await res.text()); }
    } catch (e) { console.error(e); }
  };

  useEffect(() => { fetchMe(); }, [fetchMe]);

  if (loading) return <div className="p-8 text-center">{t("common.loading")}</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="bp6-heading">{t("account.title")}</h2>
          <p className="bp6-text-muted">{t("account.subtitle")}</p>
        </div>
        {me && (
          <Tag large round intent={me.role === 'admin' ? Intent.DANGER : Intent.PRIMARY} icon={<ShieldCheck size={16} />}>
            {me.role === 'admin' ? t("account.roleAdmin") : t("account.roleUser")}
          </Tag>
        )}
      </div>

      {/* Personal Info + Password */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                    <InputGroup fill value={editUsername} onChange={e => setEditUsername(e.target.value)} autoFocus />
                    <ButtonGroup>
                      <Button icon={<Check size={16} />} intent={Intent.SUCCESS} loading={usernameLoading} onClick={handleUpdateUsername} />
                      <Button icon={<X size={16} />} onClick={() => { setIsEditingUsername(false); setEditUsername(me?.username || ""); }} />
                    </ButtonGroup>
                  </>
                ) : (
                  <>
                    <InputGroup fill value={me?.username} disabled />
                    <Button icon={<Edit2 size={16} />} onClick={() => setIsEditingUsername(true)} />
                  </>
                )}
              </div>
            </FormGroup>
            <FormGroup label={t("account.userId")}>
              <InputGroup leftIcon="id-number" value={me?.id} disabled />
            </FormGroup>
          </div>
        </Card>

        <Card elevation={Elevation.ONE}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Key size={20} className="text-orange-500" />
              <H4 style={{ margin: 0 }}>{t("account.changePassword")}</H4>
            </div>
            {me?.totp_enabled && (
              <Button 
                minimal 
                small 
                icon={<ShieldCheck size={14} className={useTotpForPw ? "text-blue-500" : "text-gray-400"} />}
                text={useTotpForPw ? t("account.totp.usePasswordInstead", "Use Password Instead") : t("account.totp.useTotpInstead", "Use 2FA Instead")}
                onClick={() => {
                  setUseTotpForPw(!useTotpForPw);
                  setPwMessage(null);
                  setOldPassword("");
                  setTotpToken("");
                }}
              />
            )}
          </div>
          {pwMessage && <Callout intent={pwMessage.intent} className="mb-4">{pwMessage.text}</Callout>}
          <form onSubmit={handleChangePassword} className="space-y-4">
            {useTotpForPw ? (
              <FormGroup label={t("account.totpCode", "Authenticator Code")}>
                <InputGroup leftIcon={<ShieldAlert size={16} />} placeholder="000000" value={totpToken} onChange={e => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))} maxLength={6} inputMode="numeric" required />
              </FormGroup>
            ) : (
              <FormGroup label={t("account.currentPassword")}>
                <InputGroup leftIcon="lock" type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} required />
              </FormGroup>
            )}
            <FormGroup label={t("account.newPassword")}>
              <InputGroup leftIcon="lock" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            </FormGroup>
            <Button fill intent={Intent.WARNING} type="submit" loading={pwLoading} text={t("account.updatePassword")} />
          </form>
        </Card>
      </div>

      {/* TOTP 2FA */}
      {me && (
        <TOTPCard user={me} onRefresh={fetchMe} />
      )}

      {/* Activity Log */}
      {me && (
        <ActivityLogCard />
      )}

      {/* Admin: User Management */}
      {me?.role === 'admin' && (
        <>
          <Divider />
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <ShieldCheck size={20} className="text-red-500" />
                <H4 style={{ margin: 0 }}>{t("account.userManagement")}</H4>
              </div>
              <Button className="whitespace-nowrap" icon={<UserPlus size={16} />} intent={Intent.SUCCESS} text={t("account.createUser")} onClick={() => setIsDialogOpen(true)} />
            </div>
            <Card elevation={Elevation.ONE} className="p-0 overflow-hidden overflow-x-auto">
              <HTMLTable interactive striped className="w-full">
                <thead>
                  <tr><th>{t("account.username")}</th><th>{t("account.role")}</th><th>ID</th><th>{t("account.createdAt")}</th><th className="text-right">{t("account.actions")}</th></tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td className="font-bold">{u.username}</td>
                      <td><Tag minimal intent={u.role === 'admin' ? Intent.DANGER : Intent.NONE}>{u.role === 'admin' ? t("account.roleAdmin") : t("account.roleUser")}</Tag></td>
                      <td><code className="text-xs">{u.id}</code></td>
                      <td className="text-xs text-gray-500">{u.created_at ? new Date(u.created_at * 1000).toLocaleString() : '-'}</td>
                      <td className="text-right"><Button minimal intent={Intent.DANGER} icon={<Trash2 size={14} />} disabled={u.id === me.id} onClick={() => handleDeleteUser(u.id)} /></td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            </Card>
          </div>

          <Divider />
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Settings size={20} className="text-gray-500" />
              <H4 style={{ margin: 0 }}>{t("account.systemSettings", "System Settings")}</H4>
            </div>
            <Card elevation={Elevation.ONE}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="space-y-4">
                  <H4 className="text-sm font-bold opacity-70 text-blue-500">Cloudflare Turnstile</H4>
                  <FormGroup label="Site Key"><InputGroup value={sysSettings.turnstile_site_key || ""} onChange={e => setSysSettings({ ...sysSettings, turnstile_site_key: e.target.value })} placeholder="0x000..." /></FormGroup>
                  <FormGroup label="Secret Key"><InputGroup type="password" value={sysSettings.turnstile_secret_key || ""} onChange={e => setSysSettings({ ...sysSettings, turnstile_secret_key: e.target.value })} placeholder="0x000..." /></FormGroup>
                </div>
                <div className="space-y-4">
                  <H4 className="text-sm font-bold opacity-70 text-green-500">{t("account.featureToggle", "Feature Toggle")}</H4>
                  <Switch label={t("account.enableTurnstileSignup", "Enable verification on Signup")} checked={sysSettings.turnstile_enabled_signup === 'true'} onChange={e => setSysSettings({ ...sysSettings, turnstile_enabled_signup: String(e.currentTarget.checked) })} />
                  <Switch label={t("account.enableTurnstileLogin", "Enable verification on Login")} checked={sysSettings.turnstile_enabled_login === 'true'} onChange={e => setSysSettings({ ...sysSettings, turnstile_enabled_login: String(e.currentTarget.checked) })} />
                </div>
              </div>
              <Divider className="my-4" />
              <div className="flex justify-end"><Button intent={Intent.PRIMARY} icon="floppy-disk" text={t("common.save", "Save")} loading={sysLoading} onClick={handleSaveSysSettings} /></div>
            </Card>
          </div>
        </>
      )}

      {/* Danger Zone */}
      <Divider />
      <div className="space-y-4">
        <H4 className="text-red-500 flex items-center gap-2"><Trash2 size={20} /> {t("account.dangerZone")}</H4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card elevation={Elevation.ONE}>
            <H4>{t("account.clearLogs")}</H4>
            <p className="text-xs opacity-60 mb-4">{t("account.clearLogsDesc")}</p>
            <Button fill intent={Intent.DANGER} text={t("account.clearLogsBtn")} icon="trash" onClick={handleClearAllLogs} />
          </Card>
          {me?.role !== 'admin' && (
            <Card elevation={Elevation.ONE}>
              <H4>{t("account.deleteAccount")}</H4>
              <p className="text-xs opacity-60 mb-4">{t("account.deleteAccountDesc")}</p>
              <Button fill intent={Intent.DANGER} text={t("account.deleteAccountBtn")} icon="delete" onClick={handleDeleteMyAccount} />
            </Card>
          )}
        </div>
        <Callout intent={Intent.WARNING} icon="info-sign" title={t("account.inactivityPolicy")}>
          <p className="text-sm">{t("account.inactivityDesc")}</p>
        </Callout>
      </div>

      {/* Create User Dialog */}
      <Dialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} title={t("account.createNewUser")} icon="user">
        <div className="p-6 space-y-4">
          <FormGroup label={t("account.username")}><InputGroup value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder={t("auth.usernamePlaceholder")} /></FormGroup>
          <FormGroup label={t("account.initialPassword")}><InputGroup type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} /></FormGroup>
          <FormGroup label={t("account.userRole")}><HTMLSelect fill value={newUserRole} onChange={e => setNewUserRole(e.target.value as any)} options={[{ label: t("account.roleUser"), value: "user" }, { label: t("account.roleAdmin"), value: "admin" }]} /></FormGroup>
          <div className="flex justify-end gap-2 mt-6">
            <Button text={t("account.cancel")} onClick={() => setIsDialogOpen(false)} />
            <Button intent={Intent.PRIMARY} text={t("account.createNow")} loading={createLoading} onClick={handleCreateUser} />
          </div>
        </div>
      </Dialog>
    </div>
  );
};
