import React, { useState, useRef } from "react";
import {
  ComposableMap,
  ZoomableGroup,
  createCoordinates,
  createTranslateExtent,
} from "@vnedyalk0v/react19-simple-maps";

import { useMapData } from "./hooks/useMapData";
import { ZoomControls } from "./components/ZoomControls";
import { Legend } from "./components/Legend";
import { MapTooltip } from "./components/MapTooltip";
import { MapGeographies } from "./components/MapGeographies";
import { MapMarkers } from "./components/MapMarkers";
import type { DestinationItem, HoveredCountry } from "./types";

interface DestinationMapProps {
  destinations: DestinationItem[];
  profileId: string;
  range: string;
  customRange: { start: string; end: string };
  accessPointId?: string;
}

export const DestinationMap: React.FC<DestinationMapProps> = ({
  destinations,
  profileId,
  range,
  customRange,
  accessPointId,
}) => {
  const {
    geographyData,
    destinationMap,
    scaleConfig,
    getLevel,
    formatNumber,
  } = useMapData(destinations);

  const [position, setPosition] = useState({ coordinates: createCoordinates(0, 0), zoom: 1 });
  const [hoveredCountry, setHoveredCountry] = useState<HoveredCountry | null>(null);
  const [ispCache, setIspCache] = useState<Record<string, { name: string; count: number }[]>>({});
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Clear cache when filters change
  React.useEffect(() => {
    setIspCache({});
  }, [profileId, range, customRange, accessPointId]);

  const handleCacheIsp = React.useCallback((countryCode: string, isps: { name: string; count: number }[]) => {
    setIspCache((prev) => ({
      ...prev,
      [countryCode]: isps
    }));
  }, []);

  const bounds = React.useMemo(() => {
    return createTranslateExtent(
      createCoordinates(-100, -50),
      createCoordinates(900, 450)
    );
  }, []);

  const handleZoomIn = () => {
    if (position.zoom >= 8) return;
    setPosition((pos) => ({ ...pos, zoom: pos.zoom * 1.5 }));
  };

  const handleZoomOut = () => {
    if (position.zoom <= 1) return;
    setPosition((pos) => ({ ...pos, zoom: pos.zoom / 1.5 }));
  };

  const handleReset = () => {
    setPosition({ coordinates: createCoordinates(0, 0), zoom: 1 });
  };

  return (
    <div className="relative w-full h-100 mt-4 bg-gray-50 dark:bg-slate-950 rounded-xl overflow-hidden border border-gray-100 dark:border-slate-800 flex flex-col justify-between shadow-sm">
      {/* Map wrapper */}
      <div
        ref={containerRef}
        className="relative w-full flex-1 overflow-hidden select-none cursor-grab active:cursor-grabbing"
        onClick={(e) => {
          if (e.target === e.currentTarget || (e.target as SVGElement).tagName === "svg") {
            setHoveredCountry(null);
          }
        }}
      >
        <ComposableMap
          projection="geoEqualEarth"
          width={800}
          height={400}
          style={{ width: "100%", height: "100%" }}
        >
          <ZoomableGroup
            zoom={position.zoom}
            center={position.coordinates}
            onMoveEnd={(pos) => setPosition({ coordinates: createCoordinates(pos.coordinates[0], pos.coordinates[1]), zoom: pos.zoom })}
            maxZoom={8}
            minZoom={1}
            enablePan={true}
            translateExtent={bounds}
          >
            <MapGeographies
              geographyData={geographyData}
              destinationMap={destinationMap}
              getLevel={getLevel}
              containerRef={containerRef}
              setHoveredCountry={setHoveredCountry}
            />

            <MapMarkers
              destinationMap={destinationMap}
              getLevel={getLevel}
              containerRef={containerRef}
              setHoveredCountry={setHoveredCountry}
            />
          </ZoomableGroup>
        </ComposableMap>

        {/* Tooltip */}
        {hoveredCountry && (
          <MapTooltip
            name={hoveredCountry.name}
            count={hoveredCountry.count}
            flag={hoveredCountry.flag}
            x={hoveredCountry.x}
            y={hoveredCountry.y}
            countryCode={hoveredCountry.code}
            profileId={profileId}
            range={range}
            customRange={customRange}
            accessPointId={accessPointId}
            ispCache={ispCache}
            onCacheIsp={handleCacheIsp}
          />
        )}
      </div>

      {/* Zoom Controls */}
      <ZoomControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onReset={handleReset}
      />

      {/* Legend */}
      <Legend
        maxThreshold={scaleConfig.maxThreshold}
        formatNumber={formatNumber}
      />
    </div>
  );
};
