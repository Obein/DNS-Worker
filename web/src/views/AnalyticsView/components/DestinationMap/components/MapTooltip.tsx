import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";

interface MapTooltipProps {
  name: string;
  count: number;
  flag: string;
  x: number;
  y: number;
  countryCode: string;
  profileId: string;
  range: string;
  customRange: { start: string; end: string };
  accessPointId?: string;
  ispCache: Record<string, { name: string; count: number }[]>;
  onCacheIsp: (countryCode: string, isps: { name: string; count: number }[]) => void;
  isPinned: boolean;
  onClose: () => void;
}

export const MapTooltip: React.FC<MapTooltipProps> = ({
  name,
  count,
  flag,
  x,
  y,
  countryCode,
  profileId,
  range,
  customRange,
  accessPointId,
  ispCache,
  onCacheIsp,
  isPinned,
  onClose,
}) => {
  const { t } = useTranslation();
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ left: x, top: y - 10, alignBottom: false });
  const [isps, setIsps] = useState<{ name: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);

  const cacheRef = useRef(ispCache);
  cacheRef.current = ispCache;
  const onCacheIspRef = useRef(onCacheIsp);
  onCacheIspRef.current = onCacheIsp;

  useEffect(() => {
    if (!countryCode || !profileId) return;
    if (count <= 0) {
      setIsps([]);
      setLoading(false);
      return;
    }

    const cached = cacheRef.current[countryCode];
    if (cached) {
      setIsps(cached);
      setLoading(false);
      return;
    }

    setLoading(true);
    let queryParams = `?country_code=${countryCode}&range=${range}`;
    if (range === "custom" && customRange.start && customRange.end) {
      const startTs = Math.floor(new Date(customRange.start).getTime() / 1000);
      const endTs = Math.floor(new Date(customRange.end).getTime() / 1000);
      queryParams += `&start=${startTs}&end=${endTs}`;
    }
    if (accessPointId) {
      queryParams += `&access_point_id=${accessPointId}`;
    }

    let isMounted = true;
    const timer = setTimeout(() => {
      fetch(`/api/profiles/${profileId}/analytics/isps${queryParams}`)
        .then((r) => r.json())
        .then((data) => {
          onCacheIspRef.current(countryCode, data);
          if (isMounted) {
            setIsps(data);
          }
        })
        .catch((e) => {
          console.error("Failed to fetch ISPs", e);
        })
        .finally(() => {
          if (isMounted) {
            setLoading(false);
          }
        });
    }, 200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [countryCode, profileId, range, customRange, accessPointId, count]);

  useEffect(() => {
    if (!isPinned) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        const isGeography = target.classList.contains("rsm-geography") || target.closest(".rsm-geography");
        const isMarker = target.classList.contains("map-marker-circle") || target.closest(".map-marker-circle");
        if (!isGeography && !isMarker) {
          onClose();
        }
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("click", handleOutsideClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleOutsideClick, true);
    };
  }, [isPinned, onClose]);

  useLayoutEffect(() => {
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
  }, [x, y, isps]);

  return (
    <div
      ref={tooltipRef}
      onMouseLeave={isPinned ? onClose : undefined}
      className={`absolute bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm px-3 py-2 rounded-lg shadow-xl border border-gray-200/50 dark:border-slate-800/50 text-xs z-50 flex flex-col gap-1 transition-all duration-75 text-gray-900 dark:text-gray-100 ${
        isPinned ? "pointer-events-auto cursor-default" : "pointer-events-none"
      }`}
      style={{
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        transform: coords.alignBottom ? "translate(-50%, 0)" : "translate(-50%, -100%)",
      }}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 font-semibold whitespace-nowrap">
            <span className="text-sm">{flag}</span>
            <span>{name}</span>
          </div>
          <div className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {count.toLocaleString()} {t("analytics.queries")}
          </div>
        </div>
        {isPinned && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="flex items-center justify-center p-2 rounded-lg border border-gray-200 dark:border-slate-800 text-gray-500 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 hover:border-red-200 dark:hover:border-red-900/50 transition-colors cursor-pointer self-stretch aspect-square"
            title={t("common.close", "Close")}
          >
            <X size={18} />
          </button>
        )}
      </div>
      {loading ? (
        <div className="mt-1.5 pt-1.5 border-t border-gray-150 dark:border-slate-850 flex flex-col gap-1 min-w-36">
          <div className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider">
            {t("analytics.topIsps", "Top ISPs")}
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 italic">
            {t("analytics.loading", "Loading...")}
          </div>
        </div>
      ) : (
        isps.length > 0 && (
          <div className="mt-1.5 pt-1.5 border-t border-gray-150 dark:border-slate-800 flex flex-col gap-1">
            <div className="text-[10px] uppercase font-bold text-gray-400 dark:text-gray-500 tracking-wider">
              {t("analytics.topIsps", "Top ISPs")}
            </div>
            <div
              className={`flex flex-col gap-0.5 min-w-36 max-w-48 ${
                isPinned ? "max-h-36 overflow-y-auto pr-1" : ""
              }`}
            >
              {(isPinned ? isps : isps.slice(0, 5)).map((isp) => (
                <div key={isp.name} className="flex justify-between gap-3 text-[11px] text-gray-600 dark:text-gray-300">
                  <span className="truncate" title={isp.name}>{isp.name}</span>
                  <span className="font-mono text-gray-400 dark:text-gray-500">{isp.count.toLocaleString()}</span>
                </div>
              ))}
              {!isPinned && isps.length > 5 && (
                <>
                  <div className="text-center text-gray-400 dark:text-gray-500 leading-none py-0.5 font-bold">...</div>
                  <div className="text-[10px] text-center text-blue-500 dark:text-blue-400 font-medium whitespace-nowrap mt-0.5">
                    {t("analytics.pressToShowMore", "Click to show more")}
                  </div>
                </>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
};
