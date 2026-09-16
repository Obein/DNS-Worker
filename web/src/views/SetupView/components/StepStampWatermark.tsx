import React from "react";
import { clsx } from "clsx";

export interface StepStampWatermarkProps {
  /**
   * The step number to display in the postmark center (e.g. 1, 2, 3)
   */
  step: number;
  /**
   * Optional custom class names for positioning or styling overrides
   */
  className?: string;
  /**
   * Optional label displayed above the center number. Defaults to "STEP".
   */
  label?: string;
  /**
   * Optional width/height size in pixels. Defaults to 72.
   */
  size?: number;
}

/**
 * StepStampWatermark renders a semi-transparent circular postal stamp (邮戳) watermark.
 * Used as a background sequence watermark in the top-left corner of setup cards.
 *
 * @param props Component properties including step number, optional label, size, and styling.
 * @returns React SVG watermark component.
 */
export const StepStampWatermark: React.FC<StepStampWatermarkProps> = ({
  step,
  className,
  label = "STEP",
  size = 72,
}) => {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        "absolute top-1 left-2 pointer-events-none select-none z-0",
        "text-blue-600/12 dark:text-blue-400/16",
        "transition-opacity duration-300",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full transform -rotate-12"
      >
        {/* Outer solid stamp ring */}
        <circle
          cx="50"
          cy="50"
          r="46"
          stroke="currentColor"
          strokeWidth="2.2"
        />

        {/* Inner dashed stamp ring */}
        <circle
          cx="50"
          cy="50"
          r="40"
          stroke="currentColor"
          strokeWidth="1"
          strokeDasharray="3 2"
        />

        {/* Inner fine solid stamp ring */}
        <circle
          cx="50"
          cy="50"
          r="36.5"
          stroke="currentColor"
          strokeWidth="1.2"
        />

        {/* Upper horizontal divider bar */}
        <line
          x1="17"
          y1="36"
          x2="83"
          y2="36"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Lower horizontal divider bar */}
        <line
          x1="17"
          y1="64"
          x2="83"
          y2="64"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Top arc label (STEP / STAGE) */}
        <text
          x="50"
          y="27"
          textAnchor="middle"
          fill="currentColor"
          fontSize="9"
          fontWeight="700"
          letterSpacing="0.2em"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
        >
          {label}
        </text>

        {/* Center step sequence number */}
        <text
          x="50"
          y="52"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="26"
          fontWeight="900"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
        >
          {step}
        </text>

        {/* Bottom postal stamp stars */}
        <text
          x="50"
          y="76"
          textAnchor="middle"
          dominantBaseline="central"
          fill="currentColor"
          fontSize="8"
          letterSpacing="0.25em"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
        >
          ★★★
        </text>
      </svg>
    </div>
  );
};
