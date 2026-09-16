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
 * StepStampWatermark renders a minimalist circular number watermark.
 * Scaled 2x and positioned at the top-left edge of the card, overflowing the boundary
 * but clipped cleanly by the card container's overflow-hidden.
 *
 * @param props Component properties including step number, size, and styling.
 * @returns React SVG watermark component.
 */
export const StepStampWatermark: React.FC<StepStampWatermarkProps> = ({
  step,
  className,
  size = 144,
}) => {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "absolute -top-7 -left-7 pointer-events-none select-none z-0",
        "text-blue-600/[0.08] dark:text-blue-400/[0.12]",
        "transition-opacity duration-300",
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
        {/* Minimalist clean circular stroke */}
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke="currentColor"
          strokeWidth="3.2"
        />

        {/* Prominent centered step number */}
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="54"
          fontWeight="900"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
        >
          {step}
        </text>
      </svg>
    </div>
  );
};
