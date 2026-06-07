import React from "react";
import { Card, Elevation, HTMLSelect, InputGroup, Button, Intent, FormGroup } from "@blueprintjs/core";
import { Plus, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";

export interface AddRuleCardProps {
  newRule: {
    type: string;
    pattern: string;
    v_a: string;
    v_aaaa: string;
    v_txt: string;
    v_cname: string;
  };
  setNewRule: (rule: any) => void;
  addRule: () => void;
}

export const AddRuleCard: React.FC<AddRuleCardProps> = ({ newRule, setNewRule, addRule }) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.ONE} className="mb-8 p-6">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col lg:flex-row justify-between gap-4 items-start lg:items-end">
          <div className="w-full lg:w-48">
            <FormGroup label={t("rules.action")} labelFor="rule-type">
              <HTMLSelect
                id="rule-type"
                fill
                large
                value={newRule.type}
                onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}
                options={[
                  { label: t("rules.typeBlock"), value: "BLOCK" },
                  { label: t("rules.typeAllow"), value: "ALLOW" },
                  { label: t("rules.typeRedirect"), value: "REDIRECT" },
                ]}
              />
            </FormGroup>
          </div>
          <div className="flex-1 w-full lg:w-48">
            <FormGroup label={t("rules.pattern")} labelFor="rule-pattern">
              <InputGroup
                id="rule-pattern"
                size="large"
                placeholder={t("rules.patternPlaceholder")}
                value={newRule.pattern}
                onChange={(e) => setNewRule({ ...newRule, pattern: e.target.value })}
              />
            </FormGroup>
          </div>
          {newRule.type !== "REDIRECT" && (
            <FormGroup label="" labelFor="">
              <Button intent={Intent.PRIMARY} size="large" icon={<Plus size={18} />} onClick={addRule}>
                {t("rules.addRule")}
              </Button>
            </FormGroup>
          )}
        </div>

        {newRule.type === "REDIRECT" && (
          <div className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2 mb-4 text-blue-600 dark:text-blue-400">
              <Globe size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">{t("rules.redirectSettings")}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              <FormGroup label={t("rules.aRecord")} labelInfo={t("rules.optional")}>
                <InputGroup
                  placeholder={t("rules.ipv4Placeholder")}
                  value={newRule.v_a}
                  onChange={(e) => setNewRule({ ...newRule, v_a: e.target.value })}
                />
              </FormGroup>

              <FormGroup label={t("rules.aaaaRecord")} labelInfo={t("rules.optional")}>
                <InputGroup
                  placeholder={t("rules.ipv6Placeholder")}
                  value={newRule.v_aaaa}
                  onChange={(e) => setNewRule({ ...newRule, v_aaaa: e.target.value })}
                />
              </FormGroup>

              <FormGroup label={t("rules.cnameRecord")} labelInfo={t("rules.optional")}>
                <InputGroup
                  placeholder={t("rules.cnamePlaceholder")}
                  value={newRule.v_cname}
                  onChange={(e) => setNewRule({ ...newRule, v_cname: e.target.value })}
                />
              </FormGroup>

              <FormGroup label={t("rules.txtRecord")} labelInfo={t("rules.optional")}>
                <InputGroup
                  placeholder={t("rules.txtPlaceholder")}
                  value={newRule.v_txt}
                  onChange={(e) => setNewRule({ ...newRule, v_txt: e.target.value })}
                />
              </FormGroup>
            </div>

            <div className="mt-6 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-end">
              <Button
                intent={Intent.PRIMARY}
                large
                icon={<Plus size={18} />}
                onClick={addRule}
                text={t("rules.saveRedirectRule")}
              />
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
