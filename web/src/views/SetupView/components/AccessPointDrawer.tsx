import React, { useState } from "react";
import { Drawer, Position, Section, SectionCard, Button, Intent, Spinner, Dialog, Classes, InputGroup, Tooltip, PopoverNext } from "@blueprintjs/core";
import { Trash2, Edit2, RefreshCw, Plus, MonitorSmartphone, Copy, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AccessPoint } from "../../../types/auth";
import { formatDateTime } from "../../../utils/date";

const AP_NAME_REGEX = /^[a-zA-Z0-9_-]{1,30}$/;

export interface AccessPointDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string;
  isMobile: boolean;
  accessPoints: AccessPoint[];
  loading: boolean;
  onRefresh: () => void;
  toasterRef: React.MutableRefObject<any>;
}

export const AccessPointDrawer: React.FC<AccessPointDrawerProps> = ({
  isOpen,
  onClose,
  profileId,
  isMobile,
  accessPoints,
  loading,
  onRefresh,
  toasterRef,
}) => {
  const { t } = useTranslation();
  
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newApName, setNewApName] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [renameApId, setRenameApId] = useState<string | null>(null);
  const [renameApName, setRenameApName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  const [rotatingApId, setRotatingApId] = useState<string | null>(null);
  const [deletingApId, setDeletingApId] = useState<string | null>(null);

  const [newApNameFocused, setNewApNameFocused] = useState(false);
  const [renameApNameFocused, setRenameApNameFocused] = useState(false);
  const [rotateConfirmApId, setRotateConfirmApId] = useState<string | null>(null);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAccessPoints = accessPoints.filter(ap => 
    ap.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    ap.token.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isValidApName = (name: string) => AP_NAME_REGEX.test(name);

  const handleAdd = async () => {
    const trimmedName = newApName.trim();
    if (!trimmedName) return;

    if (accessPoints.some(ap => ap.name.toLowerCase() === trimmedName.toLowerCase())) {
      toasterRef.current?.show({ message: t("setup.accessPointNameExists", "Access Point name already exists"), intent: Intent.DANGER });
      return;
    }

    setIsAdding(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/access_points`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      if (res.ok) {
        toasterRef.current?.show({ message: t("setup.accessPointCreated"), intent: Intent.SUCCESS });
        setIsAddDialogOpen(false);
        setNewApName("");
        onRefresh();
      } else {
        const errMsg = await res.text();
        toasterRef.current?.show({ message: errMsg || "Failed to create access point", intent: Intent.DANGER });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsAdding(false);
    }
  };

  const handleRename = async () => {
    const trimmedName = renameApName.trim();
    if (!trimmedName || !renameApId) return;

    if (accessPoints.some(ap => ap.id !== renameApId && ap.name.toLowerCase() === trimmedName.toLowerCase())) {
      toasterRef.current?.show({ message: t("setup.accessPointNameExists", "Access Point name already exists"), intent: Intent.DANGER });
      return;
    }

    setIsRenaming(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/access_points/${renameApId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName })
      });
      if (res.ok) {
        toasterRef.current?.show({ message: t("setup.accessPointRenamed"), intent: Intent.SUCCESS });
        setRenameApId(null);
        onRefresh();
      } else {
        const errMsg = await res.text();
        toasterRef.current?.show({ message: errMsg || "Failed to rename access point", intent: Intent.DANGER });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleRotate = async (apId: string) => {
    setRotatingApId(apId);
    try {
      const res = await fetch(`/api/profiles/${profileId}/access_points/${apId}/rotate_token`, {
        method: "POST"
      });
      if (res.ok) {
        toasterRef.current?.show({ message: t("setup.tokenRotated"), intent: Intent.SUCCESS });
        onRefresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setRotatingApId(null);
    }
  };

  const handleDelete = async (apId: string) => {
    if (!confirm(t("setup.deleteAccessPointConfirm"))) return;
    setDeletingApId(apId);
    try {
      const res = await fetch(`/api/profiles/${profileId}/access_points/${apId}`, {
        method: "DELETE"
      });
      if (res.ok) {
        toasterRef.current?.show({ message: t("setup.accessPointDeleted"), intent: Intent.SUCCESS });
        onRefresh();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDeletingApId(null);
    }
  };

  return (
    <>
      <Drawer
        isOpen={isOpen}
        onClose={onClose}
        title={
          isSearchOpen ? (
            <InputGroup
              leftIcon="search"
              placeholder={t("setup.searchAccessPoints", "Search...")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              rightElement={<Button icon="cross" minimal onClick={() => { setIsSearchOpen(false); setSearchQuery(""); }} />}
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2">
              <span>{t("setup.manageAccessPoints")}</span>
              <Button icon={<Search size={14} />} minimal onClick={() => setIsSearchOpen(true)} className="opacity-50 hover:opacity-100" />
            </div>
          )
        }
        icon="diagram-tree"
        position={Position.RIGHT}
        size={isMobile ? "100%" : "450px"}
        className="dark:bg-gray-900 dark:text-white shadow-none! bg-transparent! bg-bulletin! backdrop-blur-sm!"
      >
        <div className="p-6 space-y-4 overflow-y-auto h-full pb-safe">
          <Button 
            fill 
            intent={Intent.PRIMARY} 
            icon={<Plus size={16} />} 
            text={t("setup.addAccessPoint")} 
            onClick={() => setIsAddDialogOpen(true)}
            large
          />

          {loading ? (
            <div className="flex justify-center p-8"><Spinner /></div>
          ) : (
            <div className="space-y-4 mt-4">
              {filteredAccessPoints.map(ap => (
                <Section key={ap.id} title={
                  <div className="flex items-center gap-2">
                    <MonitorSmartphone size={16} />
                    <span>{ap.name}</span>
                  </div>
                } className="shadow-none! rounded-lg!">
                  <SectionCard>
                    <div className="space-y-3">
                      <div className="flex justify-between items-start gap-4">
                        <span className="text-xs opacity-50 mt-1">DoH URL</span>
                        <div 
                          className="flex items-center gap-2 text-sm font-mono bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400 px-2 py-1 rounded cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors break-all"
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/${ap.token}`);
                            toasterRef.current?.show({ message: t("setup.copied"), intent: Intent.SUCCESS });
                          }}
                          title={t("setup.copyUrl")}
                        >
                          <span className="select-all">{`${window.location.origin}/${ap.token}`}</span>
                          <Copy size={14} className="shrink-0" />
                        </div>
                      </div>
                      <div className="flex justify-between items-start gap-4">
                        <span className="text-xs opacity-50 mt-1">{t("setup.accessPointToken")}</span>
                        <span className="text-sm font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all break-all">{ap.token}</span>
                      </div>
                      <div className="flex justify-between items-start gap-4">
                        <span className="text-xs opacity-50 mt-1">Created</span>
                        <span className="text-sm">{formatDateTime(new Date(ap.created_at * 1000))}</span>
                      </div>
                    </div>
                    
                    <div className="mt-4 flex gap-2 flex-wrap">
                      <Button 
                        small 
                        icon={<Edit2 size={14} />} 
                        text={t("setup.renameAccessPoint")} 
                        onClick={() => { setRenameApId(ap.id); setRenameApName(ap.name); }}
                      />
                      <PopoverNext
                        isOpen={rotateConfirmApId === ap.id}
                        onInteraction={(nextOpenState) => {
                          if (!nextOpenState) {
                            setRotateConfirmApId(null);
                          }
                        }}
                        content={
                          <div className="p-4 space-y-3 dark:bg-gray-800 dark:text-white max-w-xs">
                            <p className="text-xs font-semibold leading-relaxed">
                              {t("setup.rotateTokenConfirmDesc", "Rotating the key will immediately disconnect devices using the old key. Are you sure you want to continue?")}
                            </p>
                            <div className="flex justify-end gap-2">
                              <Button
                                small
                                minimal
                                text={t("common.cancel", "Cancel")}
                                onClick={() => setRotateConfirmApId(null)}
                              />
                              <Button
                                small
                                intent={Intent.DANGER}
                                text={t("common.confirm", "Confirm")}
                                onClick={() => {
                                  setRotateConfirmApId(null);
                                  handleRotate(ap.id);
                                }}
                              />
                            </div>
                          </div>
                        }
                        placement="top"
                      >
                        <Button 
                          small 
                          icon={<RefreshCw size={14} />} 
                          text={t("setup.rotateToken")} 
                          loading={rotatingApId === ap.id}
                          onClick={() => setRotateConfirmApId(ap.id)}
                        />
                      </PopoverNext>
                      <Button 
                        small 
                        intent={Intent.DANGER}
                        icon={<Trash2 size={14} />} 
                        text={t("setup.deleteAccessPoint")}
                        loading={deletingApId === ap.id}
                        onClick={() => handleDelete(ap.id)}
                        disabled={accessPoints.length <= 1} // Prevent deleting the last access point
                        title={accessPoints.length <= 1 ? "Cannot delete the only access point" : undefined}
                      />
                    </div>
                  </SectionCard>
                </Section>
              ))}
            </div>
          )}
        </div>
      </Drawer>

      <Dialog isOpen={isAddDialogOpen} onClose={() => { setIsAddDialogOpen(false); setNewApName(""); }} title={t("setup.addAccessPoint")}>
        <div className={Classes.DIALOG_BODY}>
          <Tooltip
            content={t("setup.accessPointNameFormatTip", "1-30 characters, letters, numbers, hyphens and underscores allowed")}
            isOpen={newApNameFocused}
            position={Position.TOP}
            intent={Intent.PRIMARY}
            className="w-full"
          >
            <div className="w-full block">
              <InputGroup
                autoFocus
                large
                placeholder={t("setup.accessPointName")}
                value={newApName}
                onChange={(e) => setNewApName(e.target.value)}
                onFocus={() => setNewApNameFocused(true)}
                onBlur={() => setNewApNameFocused(false)}
              />
            </div>
          </Tooltip>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => { setIsAddDialogOpen(false); setNewApName(""); }}>Cancel</Button>
            <Button intent={Intent.PRIMARY} onClick={handleAdd} loading={isAdding} disabled={!isValidApName(newApName)}>
              {t("common.create")}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog isOpen={!!renameApId} onClose={() => setRenameApId(null)} title={t("setup.renameAccessPoint")}>
        <div className={Classes.DIALOG_BODY}>
          <Tooltip
            content={t("setup.accessPointNameFormatTip", "1-30 characters, letters, numbers, hyphens and underscores allowed")}
            isOpen={renameApNameFocused}
            position={Position.TOP}
            intent={Intent.PRIMARY}
            className="w-full"
          >
            <div className="w-full block">
              <InputGroup
                autoFocus
                large
                placeholder={t("setup.accessPointName")}
                value={renameApName}
                onChange={(e) => setRenameApName(e.target.value)}
                onFocus={() => setRenameApNameFocused(true)}
                onBlur={() => setRenameApNameFocused(false)}
              />
            </div>
          </Tooltip>
        </div>
        <div className={Classes.DIALOG_FOOTER}>
          <div className={Classes.DIALOG_FOOTER_ACTIONS}>
            <Button onClick={() => setRenameApId(null)}>Cancel</Button>
            <Button intent={Intent.PRIMARY} onClick={handleRename} loading={isRenaming} disabled={!isValidApName(renameApName)}>
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
};
