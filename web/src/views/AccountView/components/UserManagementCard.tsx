import React, { useState } from "react";
import { Card, Elevation, H4, Button, Intent, HTMLTable, Dialog, FormGroup, InputGroup, HTMLSelect, Tag } from "@blueprintjs/core";
import { ShieldCheck, UserPlus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  UserInfo  } from "../types";

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

  const handleCreateUser = async () => {
    if (!/^[a-zA-Z0-9]{5,15}$/.test(newUsername)) { alert(t("account.formatTipUsername")); return; }
    if (!/^[a-zA-Z0-9]{12,}$/.test(newUserPassword)) { alert(t("account.formatTipPassword")); return; }
    setCreateLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername, password: newUserPassword, role: newUserRole }),
      });
      if (res.ok) { setIsDialogOpen(false); setNewUsername(""); setNewUserPassword(""); onRefresh(); }
      else { alert(await res.text()); }
    } catch (e) { console.error(e); }
    finally { setCreateLoading(false); }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm(t("account.confirmDeleteUser"))) return;
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (res.ok) onRefresh();
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
                <td><code className="text-xs">{u.id}</code></td>
                <td className="text-xs text-gray-500">{u.created_at ? formatDateTime(new Date(u.created_at * 1000)) : '-'}</td>
                <td className="text-xs text-gray-500">{u.last_active_at ? formatDateTime(new Date(u.last_active_at * 1000)) : '-'}</td>
                <td className="text-xs text-gray-500">{u.last_resolve_at ? formatDateTime(new Date(u.last_resolve_at * 1000)) : '-'}</td>
                <td className="text-right"><Button minimal intent={Intent.DANGER} icon={<Trash2 size={14} />} disabled={u.id === currentUserId} onClick={() => handleDeleteUser(u.id)} /></td>
              </tr>
            ))}
          </tbody>
        </HTMLTable>
      </Card>

      <Dialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} title={t("account.createNewUser")} icon="user">
        <div className="p-6 space-y-4">
          <FormGroup label={t("account.username")}><InputGroup value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder={t("auth.usernamePlaceholder")} /></FormGroup>
          <FormGroup label={t("account.initialPassword")}><InputGroup type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} placeholder={t("auth.passwordPlaceholder")} /></FormGroup>
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
