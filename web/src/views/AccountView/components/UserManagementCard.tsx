import React, { useState } from "react";
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
  Callout
} from "@blueprintjs/core";
import { ShieldCheck, UserPlus, Trash2, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import { PASSWORD_REGEX, USERNAME_REGEX, hashPasswordClient } from "../../../utils/auth";
import type { UserInfo } from "../../../services";
import { createUser, deleteUser, adminResetUserPassword } from "../../../services";

export interface UserManagementCardProps {
  users: UserInfo[];
  currentUserId: string;
  onRefresh: () => void;
}

export const UserManagementCard: React.FC<UserManagementCardProps> = ({ users, currentUserId, onRefresh }) => {
  const { t } = useTranslation();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');
  const [createLoading, setCreateLoading] = useState(false);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);

  // Reset password state
  const [resetTargetUser, setResetTargetUser] = useState<UserInfo | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetSuccessMessage, setResetSuccessMessage] = useState("");
  const [resetErrorMessage, setResetErrorMessage] = useState("");

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
      alert(e.message || t("common.errorNetwork"));
    }
    finally { setCreateLoading(false); }
  };

  const handleOpenResetDialog = (u: UserInfo) => {
    setResetTargetUser(u);
    setResetPassword("");
    setShowResetPassword(false);
    setResetErrorMessage("");
    setResetSuccessMessage("");
  };

  const handleResetUserPassword = async () => {
    if (!resetTargetUser) return;
    if (!PASSWORD_REGEX.test(resetPassword)) {
      setResetErrorMessage(t("account.formatTipPassword", "密码长度至少 8 位，包含大小写字母、数字和符号"));
      return;
    }
    setResetLoading(true);
    setResetErrorMessage("");
    try {
      const clientHash = await hashPasswordClient(resetPassword, resetTargetUser.username);
      await adminResetUserPassword(resetTargetUser.id, clientHash);
      setResetSuccessMessage(t("account.resetPasswordSuccess", "密码已成功重置，用户旧登录会话已注销。"));
      setTimeout(() => {
        setResetTargetUser(null);
        setResetSuccessMessage("");
      }, 1200);
      onRefresh();
    } catch (err: any) {
      setResetErrorMessage(err.message || t("common.errorNetwork"));
    } finally {
      setResetLoading(false);
    }
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
            <tr>
              <th>{t("account.username")}</th>
              <th>{t("account.role")}</th>
              <th>MFA</th>
              <th>ID</th>
              <th>{t("account.createdAt")}</th>
              <th>{t("account.lastActive")}</th>
              <th>{t("account.lastResolve")}</th>
              <th className="text-right">{t("account.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td className="font-bold">{u.username}</td>
                <td><Tag minimal intent={u.role === 'admin' ? Intent.DANGER : Intent.NONE}>{u.role === 'admin' ? t("account.roleAdmin") : t("account.roleUser")}</Tag></td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.totp_enabled && <Tag minimal intent={Intent.SUCCESS}>TOTP</Tag>}
                    {u.passkeys_count ? <Tag minimal intent={Intent.PRIMARY}>Passkey ({u.passkeys_count})</Tag> : null}
                    {!u.totp_enabled && !u.passkeys_count && (
                      <Tag minimal intent={Intent.NONE} style={{ color: "#8a9ba8" }}>{t("account.mfaNone", "无")}</Tag>
                    )}
                  </div>
                </td>
                <td><code className="text-xs">{u.id}</code></td>
                <td className="text-xs text-gray-500">{u.created_at ? formatDateTime(new Date(u.created_at * 1000)) : '-'}</td>
                <td className="text-xs text-gray-500">{u.last_active_at ? formatDateTime(new Date(u.last_active_at * 1000)) : '-'}</td>
                <td className="text-xs text-gray-500">{u.last_resolve_at ? formatDateTime(new Date(u.last_resolve_at * 1000)) : '-'}</td>
                <td className="text-right">
                  <div className="inline-flex items-center gap-1">
                    <Button
                      minimal
                      intent={Intent.WARNING}
                      icon={<KeyRound size={14} />}
                      title={t("account.resetUserPassword", "重置密码")}
                      onClick={() => handleOpenResetDialog(u)}
                    />
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

      <Dialog
        isOpen={!!resetTargetUser}
        onClose={() => {
          setResetTargetUser(null);
          setShowResetPassword(false);
          setResetErrorMessage("");
          setResetSuccessMessage("");
        }}
        title={`${t("account.resetPasswordTitle", "重置用户密码")}: ${resetTargetUser?.username || ""}`}
        icon="key"
      >
        <div className="p-6 space-y-4">
          <Callout intent={Intent.WARNING}>
            {t(
              "account.resetPasswordWarning",
              "重置后，该用户的所有现有会话将立即注销，用户需使用新密码重新登录。"
            )}
          </Callout>
          {resetSuccessMessage && (
            <Callout intent={Intent.SUCCESS}>{resetSuccessMessage}</Callout>
          )}
          {resetErrorMessage && (
            <Callout intent={Intent.DANGER}>{resetErrorMessage}</Callout>
          )}
          <FormGroup
            label={t("account.newPassword", "新密码")}
            helperText={t("auth.formatTipPassword", "长度不少于 8 位，包含大小写字母、数字和符号")}
          >
            <InputGroup
              type={showResetPassword ? "text" : "password"}
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              placeholder={t("auth.passwordPlaceholder", "输入新密码")}
              rightElement={
                <Button
                  minimal={true}
                  icon={showResetPassword ? "eye-open" : "eye-off"}
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  title={showResetPassword ? t("auth.hidePassword", "隐藏密码") : t("auth.showPassword", "显示密码")}
                />
              }
            />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-6">
            <Button
              text={t("account.cancel", "取消")}
              onClick={() => setResetTargetUser(null)}
              disabled={resetLoading}
            />
            <Button
              intent={Intent.DANGER}
              text={t("account.confirmReset", "确认重置")}
              loading={resetLoading}
              onClick={handleResetUserPassword}
            />
          </div>
        </div>
      </Dialog>
    </>
  );
};
