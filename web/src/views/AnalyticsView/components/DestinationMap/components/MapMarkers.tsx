import React from "react";
import { Marker, createCoordinates } from "@vnedyalk0v/react19-simple-maps";
import { useTranslation } from "react-i18next";
import { getCountryName } from "../../../utils";
import { getFlagEmoji } from "../../../../../utils/getFlagEmoji";
import type { HoveredCountry, CountryMapData } from "../types";

export const microRegions: Record<string, { name: string; coordinates: [number, number] }> = {
  SG: { name: "Singapore", coordinates: [103.8198, 1.3521] },
  HK: { name: "Hong Kong", coordinates: [114.1694, 22.3193] },
  MO: { name: "Macau", coordinates: [113.5439, 22.1987] },
  VA: { name: "Vatican City", coordinates: [12.4534, 41.9029] },
  MC: { name: "Monaco", coordinates: [7.4246, 43.7384] },
  SM: { name: "San Marino", coordinates: [12.4578, 43.9424] },
  LI: { name: "Liechtenstein", coordinates: [9.5209, 47.1410] },
  AD: { name: "Andorra", coordinates: [1.5218, 42.5063] },
  MT: { name: "Malta", coordinates: [14.3754, 35.9375] },
  GI: { name: "Gibraltar", coordinates: [-5.3536, 36.1408] },
  BM: { name: "Bermuda", coordinates: [-64.7505, 32.3078] },
  MV: { name: "Maldives", coordinates: [73.5089, 4.1755] },
  MU: { name: "Mauritius", coordinates: [57.5522, -20.3484] },
};

interface MapMarkersProps {
  destinationMap: Record<string, CountryMapData>;
  getLevel: (count: number) => number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  hoveredCountry: HoveredCountry | null;
  setHoveredCountry: React.Dispatch<React.SetStateAction<HoveredCountry | null>>;
}

export const MapMarkers: React.FC<MapMarkersProps> = ({
  destinationMap,
  getLevel,
  containerRef,
  hoveredCountry,
  setHoveredCountry,
}) => {
  const { i18n } = useTranslation();

  return (
    <>
      {Object.entries(microRegions).map(([code, config]) => {
        const dest = destinationMap[code];
        const count = dest?.count || 0;
        const fillLevel = getLevel(count);
        const isQueryActive = count > 0;
        const r = isQueryActive ? 4 : 1.5;

        const updateHovered = (event: React.MouseEvent<SVGElement>) => {
          if (hoveredCountry?.isPinned) return;
          const name = getCountryName(code, i18n.language) || dest?.name || code;
          const flag = getFlagEmoji(code);
          const containerRect = containerRef.current?.getBoundingClientRect();
          const x = event.clientX - (containerRect?.left || 0);
          const y = event.clientY - (containerRect?.top || 0) - 15;
          setHoveredCountry({
            name,
            code,
            count,
            flag,
            x,
            y,
          });
        };

        const handleMarkerClick = (event: React.MouseEvent<SVGElement>) => {
          event.stopPropagation();
          const name = getCountryName(code, i18n.language) || dest?.name || code;
          const flag = getFlagEmoji(code);
          const containerRect = containerRef.current?.getBoundingClientRect();
          const x = event.clientX - (containerRect?.left || 0);
          const y = event.clientY - (containerRect?.top || 0) - 15;
          
          setHoveredCountry((prev) => {
            // Toggle pin if clicked same country
            if (prev?.code === code && prev?.isPinned) {
              return null; // Unpin
            }
            return {
              name,
              code,
              count,
              flag,
              x,
              y,
              isPinned: true
            };
          });
        };

        return (
          <Marker
            key={code}
            coordinates={createCoordinates(config.coordinates[0], config.coordinates[1])}
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
            onClick={handleMarkerClick}
          >
            {isQueryActive ? (
              <>
                <circle
                  r={r + 3}
                  fill={`var(--map-color-${fillLevel})`}
                  opacity={0.4}
                  className="animate-ping map-marker-circle"
                />
                <circle
                  r={r}
                  fill={`var(--map-color-${fillLevel})`}
                  stroke="var(--map-stroke)"
                  strokeWidth={0.75}
                  style={{ cursor: "pointer" }}
                  className="map-marker-circle"
                />
              </>
            ) : (
              <circle
                r={r}
                fill="var(--text-color)"
                opacity={0.25}
                style={{ pointerEvents: "none" }}
              />
            )}
          </Marker>
        );
      })}
    </>
  );
};
