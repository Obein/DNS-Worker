import React from "react";
import { useTranslation } from "react-i18next";

interface MapTooltipProps {
  name: string;
  count: number;
  flag: string;
  x: number;
  y: number;
  isps?: { name: string; count: number }[];
}

export const MapTooltip: React.FC<MapTooltipProps> = ({ name, count, flag, x, y, isps }) => {
  const { t } = useTranslation();
  const tooltipRef = React.useRef<HTMLDivElement>(null);
  const [coords, setCoords] = React.useState({ left: x, top: y - 10, alignBottom: false });

  React.useLayoutEffect(() => {
    if (!tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    const container = tooltipRef.current.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();

    let left = x;
    const halfWidth = rect.width / 2;
    // Prevent left overflow
    if (x - halfWidth < 4) {
      left = halfWidth + 4;
    }
    // Prevent right overflow
    else if (x + halfWidth > containerRect.width - 4) {
      left = containerRect.width - halfWidth - 4;
    }

    let top = y - 10;
    let alignBottom = false;

    // If positioning above exceeds the top boundary of the container
    if (y - rect.height - 15 < 4) {
      top = y + 15;
      alignBottom = true;
    }

    setCoords({ left, top, alignBottom });
  }, [x, y]);

  return (
    <div
      ref={tooltipRef}
      className="absolute pointer-events-none bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-xl border border-gray-200/50 dark:border-slate-800/50 text-xs z-50 flex flex-col gap-1 transition-all duration-75 text-gray-900 dark:text-gray-100"
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        transform: coords.alignBottom ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="flex items-center gap-1.5 font-semibold whitespace-nowrap">
        <span className="text-sm">{flag}</span>
        <span>{name}</span>
      </div>
      <div className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
        {count.toLocaleString()} {t("analytics.queries")}
      </div>
      {isps && isps.length > 0 && (
        <div className="mt-1.5 pt-1.5 border-t border-gray-150 dark:border-slate-800 flex flex-col gap-1">
          <div className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider">
            {t("analytics.topIsps", "Top ISPs")}
          </div>
          <div className="flex flex-col gap-0.5 min-w-36 max-w-48">
            {isps.slice(0, 5).map((isp) => (
              <div key={isp.name} className="flex justify-between gap-3 text-[11px] text-gray-600 dark:text-gray-300">
                <span className="truncate" title={isp.name}>{isp.name}</span>
                <span className="font-mono text-gray-400 dark:text-gray-500">{isp.count.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
