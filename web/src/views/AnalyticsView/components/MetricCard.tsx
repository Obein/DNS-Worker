import React from "react";
import { Card, Elevation } from "@blueprintjs/core";

export interface MetricCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon }) => (
  <Card
    elevation={Elevation.ZERO}
    className="flex items-center gap-4 p-4 dark:bg-gray-900 dark:border-gray-800 border border-gray-100 shadow-sm"
  >
    <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">{icon}</div>
    <div>
      <div className="text-xs text-gray-500 font-medium uppercase tracking-wider">{title}</div>
      <div className="text-xl font-bold dark:text-white">{value}</div>
    </div>
  </Card>
);
