import React, { useRef } from "react";
import { Drawer, Position, type DrawerProps } from "@blueprintjs/core";

export interface SwipeableDrawerProps extends Omit<DrawerProps, "position"> {
  onClose: () => void;
}

export const SwipeableDrawer: React.FC<SwipeableDrawerProps> = ({
  isOpen,
  onClose,
  title,
  icon,
  size,
  className,
  children,
  ...props
}) => {
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const diffX = touch.clientX - touchStartRef.current.x;
    const diffY = touch.clientY - touchStartRef.current.y;

    // Swipe right to close
    if (diffX > 80 && Math.abs(diffX) > Math.abs(diffY) * 1.5) {
      onClose();
      touchStartRef.current = null;
    }
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
  };

  const combinedClassName = `dark:bg-gray-900 dark:text-white shadow-none! bg-transparent! bg-bulletin! backdrop-blur-sm! ${className || ""}`;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      icon={icon}
      position={Position.RIGHT}
      size={size}
      className={combinedClassName}
      {...props}
    >
      <div
        className="p-6 space-y-4 overflow-y-auto h-full pb-safe"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </Drawer>
  );
};
