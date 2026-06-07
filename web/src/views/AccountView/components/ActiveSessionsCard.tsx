import React, { useState, useEffect, useCallback } from "react";
import { Card, Elevation, H4, Tag, Button, Intent, HTMLTable, Spinner } from "@blueprintjs/core";
import { Monitor, RefreshCw, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type { SessionInfo } from "../types";
import { UserAgentDisplay } from "./UserAgentDisplay";

export const ActiveSessionsCard: React.FC = () => {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/account/sessions");
      if (res.ok) {
        setSessions(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const handleRevoke = async (id: string) => {
    setRevoking(id);
    try {
      const res = await fetch(`/api/account/sessions/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        const data = await res.json();
        if (data.is_current) {
          window.location.reload();
        } else {
          setSessions((prev) => prev.filter((s) => s.id !== id));
        }
      } else {
        alert(t("account.sessions.revokeFailed", "Failed to revoke session."));
      }
    } catch {
      alert(t("common.errorNetwork", "Network error."));
    } finally {
      setRevoking(null);
    }
  };

  return (
    <Card elevation={Elevation.ONE}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Monitor size={20} className="text-green-500" />
          <H4 style={{ margin: 0 }}>{t("account.sessions.title", "Active Sessions")}</H4>
        </div>
        <Button
          minimal
          icon={<RefreshCw size={14} />}
          onClick={() => fetchSessions()}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner size={24} />
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-4">
          {t("account.sessions.empty", "No active sessions found.")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <HTMLTable interactive striped className="w-full text-sm">
            <thead>
              <tr>
                <th>{t("account.sessions.device", "Device")}</th>
                <th>{t("account.sessions.ip", "IP Address")}</th>
                <th>{t("account.sessions.loginTime", "Login Time")}</th>
                <th>{t("account.sessions.expires", "Expires")}</th>
                <th>{t("account.sessions.action", "Action")}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td>
                    <div className="flex items-start gap-2">
                      <UserAgentDisplay userAgent={session.user_agent} />
                      {session.is_current && (
                        <Tag minimal intent={Intent.SUCCESS} className="mt-0.5">
                          {t("account.sessions.current", "Current")}
                        </Tag>
                      )}
                    </div>
                  </td>
                  <td className="font-mono text-xs text-gray-500 align-middle">
                    {session.ip_address || "—"}
                  </td>
                  <td className="text-xs text-gray-500 align-middle">
                    {session.created_at ? formatDateTime(new Date(session.created_at * 1000)) : "—"}
                  </td>
                  <td className="text-xs text-gray-500 align-middle">
                    {formatDateTime(new Date(session.expires_at * 1000))}
                  </td>
                  <td className="align-middle">
                    <Button
                      small
                      minimal
                      intent={Intent.DANGER}
                      disabled={session.is_current}
                      icon={<LogOut size={14} />}
                      text={t("account.sessions.revoke", "Revoke")}
                      loading={revoking === session.id}
                      onClick={() => handleRevoke(session.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </HTMLTable>
        </div>
      )}
    </Card>
  );
};
