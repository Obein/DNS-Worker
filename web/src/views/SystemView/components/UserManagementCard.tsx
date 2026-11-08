import React, { useState, useEffect } from "react";
import {
  Card,
  Elevation,
  H4,
  Button,
  Intent,
  HTMLTable,
  Dialog,
  FormGroup,
  InputGroup,
  HTMLSelect,
  Tag,
  Switch,
  type OverlayToaster
} from "@blueprintjs/core";
import { ShieldCheck, UserPlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import { PASSWORD_REGEX, USERNAME_REGEX, hashPasswordClient, formatApiErrorMessage } from "../../../utils/auth";
import type { UserInfo } from "../../../services";
import { createUser, deleteUser, updateSystemSettings } from "../../../services";
import { executeWithTimeout } from "../../../utils/async";

export interface UserManagementCardProps {
  users: UserInfo[];
  currentUserId: string;
  onRefresh: () => void;
  registrationEnabled?: boolean;
  maxUsers?: string | number;
  onRefreshSettings?: () => void;
  onSavingChange?: (saving: boolean) => void;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export const UserManagementCard: React.FC<UserManagementCardProps> = ({
  users,
  currentUserId,
  onRefresh,
  registrationEnabled = true,
  maxUsers,
  onRefreshSettings,
  onSavingChange,
  toasterRef,
}) => {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [createLoading, setCreateLoading] = useState(false);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [isRegistrationEnabled, setIsRegistrationEnabled] = useState(registrationEnabled);
  const [toggleLoading, setToggleLoading] = useState(false);

  const maxUsersLimit = maxUsers !== undefined && maxUsers !== null && maxUsers !== "" ? parseInt(String(maxUsers), 10) : 0;
  const isQuotaReached = maxUsersLimit > 0 && users.length >= maxUsersLimit;

  useEffect(() => {
    setIsRegistrationEnabled(registrationEnabled);
  }, [registrationEnabled]);

  const handleToggleRegistration = async (checked: boolean) => {
    const previousState = isRegistrationEnabled;
    setIsRegistrationEnabled(checked);
    setToggleLoading(true);
    onSavingChange?.(true);
    try {
      await executeWithTimeout(
        updateSystemSettings({ registration_enabled: String(checked) }),
        10000
      );
      toasterRef?.current?.show({
        message: t("common.saveSuccess", "保存成功"),
        intent: Intent.SUCCESS,
        icon: "tick",
      });
      onRefreshSettings?.();
    } catch (e: any) {
      console.error(e);
      // Revert to original configuration
      setIsRegistrationEnabled(previousState);
      toasterRef?.current?.show({
        message: e.message || t("common.saveFailed", "保存失败"),
        intent: Intent.DANGER,
        icon: "error",
      });
    } finally {
      setToggleLoading(false);
      onSavingChange?.(false);
    }
  };

  const handleCreateUser = async () => {
    if (!USERNAME_REGEX.test(newUsername)) { alert(t("account.formatTipUsername")); return; }
    if (!PASSWORD_REGEX.test(newUserPassword)) { alert(t("account.formatTipPassword")); return; }
    setCreateLoading(true);
    try {
      const clientHash = await hashPasswordClient(newUserPassword, newUsername);
      await createUser({ username: newUsername, password: clientHash, role: newUserRole });
      setIsDialogOpen(false);
      setNewUsername("");
      setNewUserPassword("");
      setShowNewUserPassword(false);
      onRefresh();
    } catch (e: any) {
      console.error(e);
      alert(formatApiErrorMessage(e, t));
    }
    finally { setCreateLoading(false); }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm(t("account.confirmDeleteUser"))) return;
    try {
      await deleteUser(id);
      onRefresh();
    } catch (e) { console.error(e); }
  };

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={20} className="text-red-500" />
          <H4 style={{ margin: 0 }}>{t("account.userManagement")}</H4>
          {maxUsersLimit > 0 ? (
            <Tag minimal intent={isQuotaReached ? Intent.DANGER : Intent.PRIMARY} round>
              {users.length} / {maxUsersLimit}
            </Tag>
          ) : (
            <Tag minimal round>
              {users.length}
            </Tag>
          )}
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <Switch
            label={t("account.enableRegistration", "开放新用户注册")}
            checked={isRegistrationEnabled}
            disabled={toggleLoading}
            onChange={(e) => handleToggleRegistration(e.currentTarget.checked)}
            className="mb-0"
          />
          <Button
            className="whitespace-nowrap"
            icon={<UserPlus size={16} />}
            intent={Intent.SUCCESS}
            text={t("account.createUser")}
            disabled={isQuotaReached}
            title={isQuotaReached ? t("auth.maxUsersReached", "当前系统已达到用户数量上限，无法创建新用户。") : undefined}
            onClick={() => setIsDialogOpen(true)}
          />
        </div>
      </div>
      <Card elevation={Elevation.ONE} className="p-0 overflow-hidden overflow-x-auto">
        <HTMLTable interactive striped className="w-full whitespace-nowrap">
          <thead>
            <tr>
              <th className="whitespace-nowrap">{t("account.username")}</th>
              <th className="whitespace-nowrap">{t("account.role")}</th>
              <th className="whitespace-nowrap">MFA</th>
              <th className="whitespace-nowrap">ID</th>
              <th className="whitespace-nowrap">{t("account.createdAt")}</th>
              <th className="whitespace-nowrap">{t("account.lastActive")}</th>
              <th className="whitespace-nowrap">{t("account.lastResolve")}</th>
              <th className="text-right whitespace-nowrap">{t("account.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="font-bold whitespace-nowrap">{u.username}</td>
                <td className="whitespace-nowrap"><Tag minimal intent={u.role === 'admin' ? Intent.DANGER : Intent.NONE} className="whitespace-nowrap">{u.role === 'admin' ? t("account.roleAdmin") : t("account.roleUser")}</Tag></td>
                <td className="whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                    {Boolean(u.totp_enabled) && <Tag minimal intent={Intent.SUCCESS} className="whitespace-nowrap">TOTP</Tag>}
                    {Boolean(u.passkeys_count && u.passkeys_count > 0) && <Tag minimal intent={Intent.PRIMARY} className="whitespace-nowrap">Passkey</Tag>}
                    {!u.totp_enabled && !(u.passkeys_count && u.passkeys_count > 0) && (
                      <Tag minimal intent={Intent.NONE} style={{ color: "#8a9ba8" }} className="whitespace-nowrap">{t("account.mfaNone", "无")}</Tag>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap"><code className="text-xs">{u.id}</code></td>
                <td className="text-xs text-gray-500 whitespace-nowrap">{u.created_at ? formatDateTime(new Date(u.created_at * 1000)) : '-'}</td>
                <td className="text-xs text-gray-500 whitespace-nowrap">{u.last_active_at ? formatDateTime(new Date(u.last_active_at * 1000)) : '-'}</td>
                <td className="text-xs text-gray-500 whitespace-nowrap">{u.last_resolve_at ? formatDateTime(new Date(u.last_resolve_at * 1000)) : '-'}</td>
                <td className="text-right whitespace-nowrap">
                  <div className="inline-flex items-center gap-1">
                    <Button
                      minimal
                      intent={Intent.DANGER}
                      icon={<Trash2 size={14} />}
                      disabled={u.id === currentUserId}
                      onClick={() => handleDeleteUser(u.id)}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </Card>

      <Dialog isOpen={isDialogOpen} onClose={() => { setIsDialogOpen(false); setShowNewUserPassword(false); }} title={t("account.createNewUser")} icon="user">
        <div className="p-6 space-y-4">
          <FormGroup label={t("account.username")}><InputGroup value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder={t("auth.usernamePlaceholder")} /></FormGroup>
          <FormGroup label={t("account.initialPassword")}>
            <InputGroup
              type={showNewUserPassword ? "text" : "password"}
              value={newUserPassword}
              onChange={e => setNewUserPassword(e.target.value)}
              placeholder={t("auth.passwordPlaceholder")}
              rightElement={
                <Button
                  minimal={true}
                  icon={showNewUserPassword ? "eye-open" : "eye-off"}
                  onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                  title={showNewUserPassword ? t("auth.hidePassword", "Hide password") : t("auth.showPassword", "Show password")}
                />
              }
            />
          </FormGroup>
          <FormGroup label={t("account.userRole")}>
            <HTMLSelect fill value={newUserRole} onChange={e => setNewUserRole(e.target.value as any)} options={[{ label: t("account.roleUser"), value: "user" }, { label: t("account.roleAdmin"), value: "admin" }]} />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-6">
            <Button text={t("account.cancel")} onClick={() => setIsDialogOpen(false)} />
            <Button intent={Intent.PRIMARY} text={t("account.createNow")} loading={createLoading} onClick={handleCreateUser} />
          </div>
        </div>
      </Dialog>
    </>
  );
};
