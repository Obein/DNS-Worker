import React from "react";
import { clsx } from "clsx";

export interface StepStampWatermarkProps {
  /**
   * The step number to display in the circle center (e.g. 1, 2, 3)
   */
  step: number;
  /**
   * Optional custom class names for positioning or styling overrides
   */
  className?: string;
  /**
   * Optional width/height size in pixels. Defaults to 144 (2x of original 72px).
   */
  size?: number;
}

/**
 * StepStampWatermark renders a minimalist Swiss Style circular number watermark.
 * Features extra bold sans-serif numerals that crowd the circle, scaled 2x and
 * positioned at the card's top-left edge so it overflows but is cleanly clipped.
 * When the parent card is hovered (group-hover), the watermark smoothly blurs and fades out to fully transparent.
 *
 * @param props Component properties including step number, size, and styling.
 * @returns React SVG watermark component.
 */
export const StepStampWatermark: React.FC<StepStampWatermarkProps> = ({
  step,
  className,
  size = 144,
}) => {
  // Precision optical centering per step numeral
  // Digit 1 has a prominent top beak on the left, so its vertical stem is optically centered at x=47, y=45.5.
  // Digits 2 and 3 have symmetrical cap-height and horizontal balance centered at x=50, y=45.
  const offsetX = step === 1 ? 47 : 50;
  const offsetY = step === 1 ? 45.5 : 45;

  return (
    <div
      aria-hidden="true"
      className={clsx(
        "absolute -top-7 -left-7 pointer-events-none select-none z-0",
        "text-blue-600/[0.08] dark:text-blue-400/[0.12]",
        "transition-all duration-500 ease-out",
        "blur-none group-hover:blur-md group-hover:opacity-0",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full"
      >
        {/* Swiss Style geometric circle border */}
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke="currentColor"
          strokeWidth="4"
        />

        {/* Swiss Style extra bold sans-serif numeral crowding the circle */}
        <text
          x={offsetX}
          y={offsetY}
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="80"
          fontWeight="900"
          fontFamily="'Helvetica Neue', Helvetica, Arial, sans-serif"
        >
          {step}
        </text>
      </svg>
    </div>
  );
};
