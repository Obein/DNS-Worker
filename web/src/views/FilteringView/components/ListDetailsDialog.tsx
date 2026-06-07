import React from "react";
import { Dialog, Button } from "@blueprintjs/core";
import { Copy, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDateTime } from "../../../utils/date";
import type {  FilterList  } from "../types";

export interface ListDetailsDialogProps {
  selectedList: FilterList | null;
  onClose: () => void;
  onCopy: (url: string) => void;
}

export const ListDetailsDialog: React.FC<ListDetailsDialogProps> = ({ selectedList, onClose, onCopy }) => {
  const { t } = useTranslation();

  return (
    <Dialog
      isOpen={selectedList !== null}
      onClose={onClose}
      title={t("filtering.listDetails", "List Details")}
      icon="info-sign"
    >
      <div className="p-6 space-y-4">
        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 break-all font-mono text-sm">
          {selectedList?.url}
        </div>
        <div className="flex justify-between items-center">
          <span className="text-xs opacity-50">
            {t("filtering.tableLastSync")}:{" "}
            {selectedList?.last_synced_at
              ? formatDateTime(new Date(selectedList.last_synced_at * 1000))
              : "-"}
          </span>
          <div className="flex gap-2">
            <Button
              icon={<Copy size={14} />}
              text={t("setup.copyUrl", "复制链接")}
              onClick={() => {
                if (selectedList) onCopy(selectedList.url);
              }}
            />
            <Button
              icon={<ExternalLink size={14} />}
              text={t("setup.learnMore", "访问链接")}
              onClick={() => {
                if (selectedList) window.open(selectedList.url, "_blank");
              }}
            />
          </div>
        </div>
      </div>
    </Dialog>
  );
};
