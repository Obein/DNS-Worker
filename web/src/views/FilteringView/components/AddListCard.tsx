import React from "react";
import { Card, Elevation, InputGroup, Button, Popover, Position, Intent, Menu, MenuItem } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { usePresetLists } from "../hooks";
import type {  FilterList  } from "../types";

export interface AddListCardProps {
  newUrl: string;
  setNewUrl: (url: string) => void;
  onAddList: (url?: string) => void;
  syncing: boolean;
  loading: boolean;
  lists: FilterList[];
}

export const AddListCard: React.FC<AddListCardProps> = ({ newUrl, setNewUrl, onAddList, syncing, loading, lists }) => {
  const { t } = useTranslation();
  const PRESET_LISTS = usePresetLists();

  const presetMenu = (
    <Menu className="min-w-96">
      {PRESET_LISTS.map((preset, i) => (
        <MenuItem
          key={i}
          text={preset.label}
          onClick={() => onAddList(preset.url)}
          disabled={lists.some((l) => l.url === preset.url)}
          labelElement={
            <div className="flex flex-col items-end text-right">
              <span className="text-[9px] opacity-85 max-w-xl truncate" title={preset.url}>
                {preset.url}
              </span>
            </div>
          }
        />
      ))}
    </Menu>
  );

  return (
    <Card elevation={Elevation.ONE} className="mb-6">
      <div className="flex gap-2 flex-col sm:flex-row">
        <InputGroup
          fill
          size="large"
          placeholder={t("filtering.urlPlaceholder")}
          value={newUrl}
          onChange={(e) => setNewUrl(e.target.value)}
          leftIcon="globe"
          rightElement={
            <Popover content={presetMenu} position={Position.BOTTOM_RIGHT} minimal={true} usePortal={true}>
              <Button variant="minimal" icon="chevron-down" />
            </Popover>
          }
        />
        <Button
          intent={Intent.PRIMARY}
          size="large"
          icon="plus"
          onClick={() => onAddList()}
          className="shrink-0"
          loading={syncing || loading}
          disabled={syncing || loading}
        >
          {t("filtering.addSubscription")}
        </Button>
      </div>
    </Card>
  );
};
