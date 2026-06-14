import React from "react";
import { Card, Button, Intent, NonIdealState } from "@blueprintjs/core";
import { ChevronRight, Trash2, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Profile } from "../../../types/auth";

interface ProfileListProps {
  profiles: Profile[];
  onSelect: (p: Profile) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}

export const ProfileList: React.FC<ProfileListProps> = ({
  profiles,
  onSelect,
  onDelete,
}) => {
  const { t } = useTranslation();

  return (
    <div className="grid gap-3">
      {profiles.map((p: Profile) => (
        <Card
          key={p.id}
          interactive
          onClick={() => onSelect(p)}
          className="flex justify-between items-center p-4 dark:bg-gray-900 dark:border-gray-800 rounded-xl border border-gray-200"
        >
          <div className="flex flex-col">
            <span className="font-bold text-base dark:text-white">
              {p.name}
            </span>
            <code className="text-gray-400 text-[10px] font-mono uppercase mt-0.5">
              {p.id}
            </code>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="minimal"
              intent={Intent.DANGER}
              icon={<Trash2 size={16} />}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(e, p.id);
              }}
            />
            <ChevronRight size={18} className="text-gray-300" />
          </div>
        </Card>
      ))}
      {profiles.length === 0 && (
        <NonIdealState
          icon={<ShieldCheck size={48} className="text-gray-300" />}
          title={t("common.welcome")}
          description={t("common.createProfileToStart")}
        />
      )}
    </div>
  );
};
