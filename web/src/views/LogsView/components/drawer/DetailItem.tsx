import React from "react";
import { clsx } from "clsx";

export interface DetailItemProps {
  label: React.ReactNode;
  value: React.ReactNode;
  bold?: boolean;
  italic?: boolean;
}

export const DetailItem: React.FC<DetailItemProps> = ({ label, value, bold, italic }) => (
  <div className="flex justify-between items-start gap-4">
    <span className="text-xs opacity-50 mt-1">{label}</span>
    <span className={clsx("text-sm text-right", bold && "font-bold", italic && "italic")}>
      {value}
    </span>
  </div>
);
