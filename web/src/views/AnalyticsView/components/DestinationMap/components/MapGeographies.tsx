import React from "react";
import { Geographies, Geography } from "@vnedyalk0v/react19-simple-maps";
import { useTranslation } from "react-i18next";
import { numericToAlpha2 } from "../../../countryMapping";
import { getCountryName } from "../../../utils";
import { getFlagEmoji } from "../../../../../utils/getFlagEmoji";
import type { HoveredCountry, CountryMapData } from "../types";

interface MapGeographiesProps {
  geographyData: any;
  destinationMap: Record<string, CountryMapData>;
  getLevel: (count: number) => number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  hoveredCountry: HoveredCountry | null;
  setHoveredCountry: React.Dispatch<React.SetStateAction<HoveredCountry | null>>;
}

export const MapGeographies: React.FC<MapGeographiesProps> = ({
  geographyData,
  destinationMap,
  getLevel,
  containerRef,
  hoveredCountry,
  setHoveredCountry,
}) => {
  const { i18n } = useTranslation();
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
            if (!countryCode || hoveredCountry?.isPinned) return;
            const name = getCountryName(countryCode, i18n.language) || dest?.name || countryCode;
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
            });
          };

          const handleGeographyClick = (event: React.MouseEvent<SVGPathElement>) => {
            event.stopPropagation();
            if (!countryCode) return;
            const name = getCountryName(countryCode, i18n.language) || dest?.name || countryCode;
            const flag = getFlagEmoji(countryCode);
            const containerRect = containerRef.current?.getBoundingClientRect();
            const x = event.clientX - (containerRect?.left || 0);
            const y = event.clientY - (containerRect?.top || 0) - 15;
            
            setHoveredCountry((prev) => {
              // Toggle pin if clicked same country
              if (prev?.code === countryCode && prev?.isPinned) {
                return null; // Unpin
              }
              return {
                name,
                code: countryCode,
                count,
                flag,
                x,
                y,
                isPinned: true
              };
            });
          };

          return (
            <Geography
              key={geo.rsmKey}
              geography={geo}
              onMouseEnter={updateHovered}
              onMouseMove={(event) => {
                setHoveredCountry((prev) => {
                  if (prev?.isPinned) return prev;
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  const x = event.clientX - (containerRect?.left || 0);
                  const y = event.clientY - (containerRect?.top || 0) - 15;
                  return prev ? { ...prev, x, y } : null;
                });
              }}
              onMouseLeave={() => {
                setHoveredCountry((prev) => (prev?.isPinned ? prev : null));
              }}
              onClick={handleGeographyClick}
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
