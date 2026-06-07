import React from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";
import { formatDateTime } from "../../../utils/date";
import type {  TimeRange  } from "../types";

export interface TrendChartProps {
  chartData: any[];
  range: TimeRange;
}

export const TrendChart: React.FC<TrendChartProps> = ({ chartData, range }) => {
  return (
    <div className="h-64 w-full">
      {chartData.length > 0 ? (
        <ResponsiveContainer width="100%" height={256} minHeight={0} minWidth={0} debounce={50}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorAllowed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorBlocked" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="colorRedirected" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#88888822" />
            <XAxis
              dataKey="timestamp"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#888" }}
              tickFormatter={(ts) => {
                const d = new Date(ts * 1000);
                if (range === "10m" || range === "1h") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                if (range === "24h") return d.getHours() + ":00";
                return d.toLocaleDateString([], { month: "short", day: "numeric" });
              }}
              interval="preserveStartEnd"
              minTickGap={30}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: "#888" }}
              allowDecimals={false}
              domain={[0, (dataMax: number) => Math.max(1, dataMax)]}
            />
            <RechartsTooltip
              isAnimationActive={true}
              shared={true}
              labelFormatter={(ts) => {
                const d = new Date(ts * 1000);
                return formatDateTime(d, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
              }}
              contentStyle={{
                borderRadius: "16px",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.1), inset 0 0 4px rgba(255, 255, 255, 0.4)",
                color: "#d6d6d6",
                fontFamily: "monospace",
                backgroundColor: "#fefefe22",
                backdropFilter: "blur(10px) saturate(180%)",
              }}
            />
            <Area type="monotone" dataKey="allowed" stroke="#10b981" fillOpacity={1} fill="url(#colorAllowed)" strokeWidth={2} />
            <Area type="monotone" dataKey="blocked" stroke="#ef4444" fillOpacity={1} fill="url(#colorBlocked)" strokeWidth={2} />
            <Area type="monotone" dataKey="redirected" stroke="#f59e0b" fillOpacity={1} fill="url(#colorRedirected)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full flex items-center justify-center opacity-30 italic">No records</div>
      )}
    </div>
  );
};
