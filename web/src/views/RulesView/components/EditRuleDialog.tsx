import React from "react";
import { Dialog, DialogBody, DialogFooter, FormGroup, HTMLSelect, InputGroup, Button, Intent } from "@blueprintjs/core";
import { Globe, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  Rule  } from "../types";

export interface EditRuleDialogProps {
  editRule: Rule | null;
  setEditRule: (rule: Rule | null) => void;
  saveEditRule: () => void;
  cancelEdit: () => void;
  deleteRule: (id: number) => void;
}

export const EditRuleDialog: React.FC<EditRuleDialogProps> = ({ editRule, setEditRule, saveEditRule, cancelEdit, deleteRule }) => {
  const { t } = useTranslation();

  return (
    <Dialog isOpen={!!editRule} onClose={cancelEdit} title={t("rules.editRule", "Edit Rule")} style={{ width: "600px" }}>
      <DialogBody>
        {editRule && (
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <FormGroup label={t("rules.action")} className="w-40 mb-0">
                <HTMLSelect
                  fill
                  value={editRule.type}
                  onChange={(e) => setEditRule({ ...editRule, type: e.target.value as any })}
                  options={[
                    { label: t("rules.typeBlock"), value: "BLOCK" },
                    { label: t("rules.typeAllow"), value: "ALLOW" },
                    { label: t("rules.typeRedirect"), value: "REDIRECT" },
                  ]}
                />
              </FormGroup>
              <FormGroup label={t("rules.pattern")} className="flex-1 mb-0">
                <InputGroup
                  placeholder={t("rules.patternPlaceholder")}
                  value={editRule.pattern}
                  onChange={(e) => setEditRule({ ...editRule, pattern: e.target.value })}
                />
              </FormGroup>
            </div>

            {editRule.type === "REDIRECT" && (
              <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-2 mb-4 text-blue-600 dark:text-blue-400">
                  <Globe size={14} />
                  <span className="text-xs font-bold uppercase tracking-wider">{t("rules.redirectSettings")}</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormGroup label={t("rules.aRecord")} className="mb-0">
                    <InputGroup
                      placeholder={t("rules.ipv4Placeholder")}
                      value={editRule.v_a || ""}
                      onChange={(e) => setEditRule({ ...editRule, v_a: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup label={t("rules.aaaaRecord")} className="mb-0">
                    <InputGroup
                      placeholder={t("rules.ipv6Placeholder")}
                      value={editRule.v_aaaa || ""}
                      onChange={(e) => setEditRule({ ...editRule, v_aaaa: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup label={t("rules.cnameRecord")} className="mb-0">
                    <InputGroup
                      placeholder={t("rules.cnamePlaceholder")}
                      value={editRule.v_cname || ""}
                      onChange={(e) => setEditRule({ ...editRule, v_cname: e.target.value })}
                    />
                  </FormGroup>
                  <FormGroup label={t("rules.txtRecord")} className="mb-0">
                    <InputGroup
                      placeholder={t("rules.txtPlaceholder")}
                      value={editRule.v_txt || ""}
                      onChange={(e) => setEditRule({ ...editRule, v_txt: e.target.value })}
                    />
                  </FormGroup>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogBody>
      <DialogFooter
        actions={
          <div className="flex w-full justify-between">
            <Button
              icon={<Trash2 size={14} />}
              intent={Intent.DANGER}
              text={t("rules.delete", "Delete")}
              onClick={() => {
                if (editRule) deleteRule(editRule.id);
              }}
            />
            <div className="flex gap-2">
              <Button onClick={cancelEdit}>{t("rules.cancel", "Cancel")}</Button>
              <Button intent={Intent.PRIMARY} onClick={saveEditRule}>
                {t("rules.saveChanges", "Save Changes")}
              </Button>
            </div>
          </div>
        }
      />
    </Dialog>
  );
};
