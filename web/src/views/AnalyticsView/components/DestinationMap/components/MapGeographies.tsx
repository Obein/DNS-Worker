import React from "react";
import { Geographies, Geography } from "@vnedyalk0v/react19-simple-maps";
import { numericToAlpha2 } from "../../../countryMapping";
import { getFlagEmoji } from "../../../utils";
import type { HoveredCountry, CountryMapData } from "../types";

interface MapGeographiesProps {
  geographyData: any;
  destinationMap: Record<string, CountryMapData>;
  getLevel: (count: number) => number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  setHoveredCountry: React.Dispatch<React.SetStateAction<HoveredCountry | null>>;
}

export const MapGeographies: React.FC<MapGeographiesProps> = ({
  geographyData,
  destinationMap,
  getLevel,
  containerRef,
  setHoveredCountry,
}) => {
  if (!geographyData) return null;

  return (
    <Geographies geography={geographyData}>
      {({ geographies }) =>
        geographies.map((geo) => {
          const countryCode = numericToAlpha2[geo.id];
          const dest = countryCode ? destinationMap[countryCode] : null;
          const count = dest?.count || 0;
          const fillLevel = getLevel(count);

          const updateHovered = (event: React.MouseEvent<SVGPathElement>) => {
            if (!countryCode) return;
            const name = dest?.name || geo.properties.name;
            const flag = getFlagEmoji(countryCode);
            const containerRect = containerRef.current?.getBoundingClientRect();
            const x = event.clientX - (containerRect?.left || 0);
            const y = event.clientY - (containerRect?.top || 0) - 15;
            setHoveredCountry({
              name,
              code: countryCode,
              count,
              flag,
              x,
              y,
              isps: dest?.isps || [],
            });
          };

          return (
            <Geography
              key={geo.rsmKey}
              geography={geo}
              onMouseEnter={updateHovered}
              onMouseMove={(event) => {
                const containerRect = containerRef.current?.getBoundingClientRect();
                const x = event.clientX - (containerRect?.left || 0);
                const y = event.clientY - (containerRect?.top || 0) - 15;
                setHoveredCountry((prev) => (prev ? { ...prev, x, y } : null));
              }}
              onMouseLeave={() => {
                setHoveredCountry(null);
              }}
              onClick={updateHovered}
              style={{
                default: {
                  fill: `var(--map-color-${fillLevel})`,
                  stroke: "var(--map-stroke)",
                  strokeWidth: 0.5,
                  outline: "none",
                  transition: "fill 250ms, stroke 250ms",
                },
                hover: {
                  fill: "var(--map-hover)",
                  stroke: "var(--map-stroke)",
                  strokeWidth: 0.5,
                  outline: "none",
                  cursor: "pointer",
                },
                pressed: {
                  fill: "var(--map-hover)",
                  stroke: "var(--map-stroke)",
                  strokeWidth: 0.5,
                  outline: "none",
                },
              }}
            />
          );
        })
      }
    </Geographies>
  );
};
