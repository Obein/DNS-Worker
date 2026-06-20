import { useState, useEffect, useMemo } from "react";
import type { DestinationItem, CountryMapData } from "../types";
import { getMapTopology } from "../../../../../services";

export function useMapData(destinations: DestinationItem[]) {
  const [geographyData, setGeographyData] = useState<any>(null);

  useEffect(() => {
    getMapTopology()
      .then((data: any) => {
        // Ensure "countries" is the first key in data.objects because react-simple-maps
        // defaults to parsing the first key returned by Object.keys(data.objects).
        if (data && data.objects) {
          const sortedObjects: any = {};
          if (data.objects.countries) {
            sortedObjects.countries = data.objects.countries;
          }
          if (data.objects.land) {
            sortedObjects.land = data.objects.land;
          }
          data.objects = sortedObjects;
        }

        // Ensure all country geometry IDs are 3-digit padded strings (e.g. 4 -> "004")
        // to maintain compatibility with client-side country code mappings.
        if (data && data.objects && data.objects.countries && Array.isArray(data.objects.countries.geometries)) {
          data.objects.countries.geometries.forEach((geom: any) => {
            if (geom.id !== undefined && geom.id !== null) {
              geom.id = String(geom.id).padStart(3, "0");
            }
          });
        }
        setGeographyData(data);
      })
      .catch((e: any) => console.error("Failed to load map topology", e));
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
    const map: Record<string, CountryMapData> = {};
    destinations.forEach((d) => {
      if (d.country_code) {
        const code = d.country_code.toUpperCase();
        map[code] = {
          count: d.count,
          name: d.country,
          countryCode: code,
        };
      }
    });
    return map;
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
