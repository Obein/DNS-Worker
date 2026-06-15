import { useState, useEffect, useMemo } from "react";

interface DestinationItem {
  dest_geoip: string;
  count: number;
}

export function useMapData(destinations: DestinationItem[]) {
  const [geographyData, setGeographyData] = useState<any>(null);

  useEffect(() => {
    fetch("/world-110m.json")
      .then((r) => r.json())
      .then((data) => setGeographyData(data))
      .catch((e) => console.error("Failed to load map topology", e));
  }, []);

  const totalQueriesCount = useMemo(() => {
    return destinations.reduce((acc, d) => acc + d.count, 0);
  }, [destinations]);

  const scaleConfig = useMemo(() => {
    if (totalQueriesCount <= 0) {
      return { maxThreshold: 10, step: 1 };
    }
    if (totalQueriesCount <= 1000) {
      return { maxThreshold: 100, step: 10 };
    }
    const power = Math.floor(Math.log10(totalQueriesCount));
    const maxThreshold = Math.pow(10, power);
    const step = maxThreshold / 10;
    return { maxThreshold, step };
  }, [totalQueriesCount]);

  const destinationMap = useMemo(() => {
    const map: Record<
      string,
      {
        count: number;
        name: string;
        countryCode: string;
        isps: Record<string, number>;
      }
    > = {};

    destinations.forEach((d) => {
      try {
        const geo = JSON.parse(d.dest_geoip);
        if (geo && geo.country_code) {
          const code = geo.country_code.toUpperCase();
          const isp = geo.isp || "Unknown";
          if (map[code]) {
            map[code].count += d.count;
            map[code].isps[isp] = (map[code].isps[isp] || 0) + d.count;
          } else {
            map[code] = {
              count: d.count,
              name: geo.country,
              countryCode: code,
              isps: { [isp]: d.count },
            };
          }
        }
      } catch (e) {
        console.error("Failed to parse dest_geoip", e);
      }
    });

    const finalMap: Record<
      string,
      {
        count: number;
        name: string;
        countryCode: string;
        isps: { name: string; count: number }[];
      }
    > = {};

    Object.keys(map).forEach((code) => {
      const ispsArray = Object.entries(map[code].isps)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      finalMap[code] = {
        count: map[code].count,
        name: map[code].name,
        countryCode: map[code].countryCode,
        isps: ispsArray,
      };
    });

    return finalMap;
  }, [destinations]);

  const getLevel = (count: number) => {
    if (!count || count <= 0) return 0;
    return Math.min(10, Math.floor(count / scaleConfig.step) + 1);
  };

  const formatNumber = (num: number): string => {
    if (num >= 1000000) {
      const v = num / 1000000;
      return Number.isInteger(v) ? `${v}M` : `${v.toFixed(1)}M`;
    }
    if (num >= 1000) {
      const v = num / 1000;
      return Number.isInteger(v) ? `${v}K` : `${v.toFixed(1)}K`;
    }
    return num.toString();
  };

  return {
    geographyData,
    destinationMap,
    scaleConfig,
    getLevel,
    formatNumber,
  };
}
