import React, { useState, useEffect, useRef } from "react";

/**
 * Parameter interface for the useScrollingIntro hook.
 */
export interface UseScrollingIntroParams {
  /** The number of unique items in the base scroll list (before tripling). */
  itemCount: number;
}

/**
 * Return type interface for the useScrollingIntro hook.
 */
export interface UseScrollingIntroResult {
  /** A ref to be attached to the scrollable container element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** The index of the currently focused item (0 to itemCount - 1). */
  activeIdx: number;
  /** State value indicating if the auto-scrolling is paused. */
  isPaused: boolean;
  /** Setter function to pause or resume auto-scrolling. */
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * A custom hook to manage smooth auto-scrolling, mouse drag-to-scroll,
 * touch drag-to-scroll, and natural wheel scrolling for the intro list.
 *
 * @param {UseScrollingIntroParams} params The parameters specifying the base list item count.
 * @returns {UseScrollingIntroResult} An object containing state and refs for container scrolling.
 */
export const useScrollingIntro = ({ itemCount }: UseScrollingIntroParams): UseScrollingIntroResult => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const [isPaused, setIsPaused] = useState<boolean>(false);

  const isDraggingRef = useRef<boolean>(false);
  const startYRef = useRef<number>(0);
  const startScrollTopRef = useRef<number>(0);
  const wheelTimeoutRef = useRef<number | null>(null);

  // Helper to maintain infinite looping without sudden visual jumps
  const checkLoopBoundary = (container: HTMLElement): void => {
    const bubbles = Array.from(container.children) as HTMLElement[];
    if (bubbles.length >= itemCount * 3) {
      const y0 = bubbles[0].offsetTop;
      const yN = bubbles[itemCount].offsetTop;
      const loopHeight = yN - y0;
      if (loopHeight > 0) {
        if (container.scrollTop >= loopHeight * 2) {
          container.scrollTop -= loopHeight;
        } else if (container.scrollTop < loopHeight) {
          container.scrollTop += loopHeight;
        }
      }
    }
  };

  // Mouse & Touch drag handling + Wheel smoothing
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Center scroll on initial mount so user is in middle set
    requestAnimationFrame(() => {
      const bubbles = Array.from(container.children) as HTMLElement[];
      if (bubbles.length >= itemCount * 3) {
        const y0 = bubbles[0].offsetTop;
        const yN = bubbles[itemCount].offsetTop;
        const loopHeight = yN - y0;
        if (loopHeight > 0 && container.scrollTop === 0) {
          container.scrollTop = loopHeight;
        }
      }
    });

    const handleMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return; // Main button only
      isDraggingRef.current = true;
      startYRef.current = e.clientY;
      startScrollTopRef.current = container.scrollTop;
      setIsPaused(true);
    };

    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDraggingRef.current) return;
      e.preventDefault();
      const deltaY = e.clientY - startYRef.current;
      container.scrollTop = startScrollTopRef.current - deltaY;
      checkLoopBoundary(container);
    };

    const handleMouseUp = (): void => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsPaused(false);
      }
    };

    const handleTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 1) return;
      isDraggingRef.current = true;
      startYRef.current = e.touches[0].clientY;
      startScrollTopRef.current = container.scrollTop;
      setIsPaused(true);
    };

    const handleTouchMove = (e: TouchEvent): void => {
      if (!isDraggingRef.current || e.touches.length !== 1) return;
      e.preventDefault();
      const deltaY = e.touches[0].clientY - startYRef.current;
      container.scrollTop = startScrollTopRef.current - deltaY;
      checkLoopBoundary(container);
    };

    const handleTouchEnd = (): void => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false;
        setIsPaused(false);
      }
    };

    const handleWheel = (): void => {
      // Natural wheel scrolling - pause auto-scroll temporarily
      setIsPaused(true);
      if (wheelTimeoutRef.current) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
      wheelTimeoutRef.current = window.setTimeout(() => {
        setIsPaused(false);
      }, 1200);
      checkLoopBoundary(container);
    };

    container.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd);
    container.addEventListener("touchcancel", handleTouchEnd);

    container.addEventListener("wheel", handleWheel, { passive: true });

    return () => {
      container.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchEnd);

      container.removeEventListener("wheel", handleWheel);

      if (wheelTimeoutRef.current) {
        window.clearTimeout(wheelTimeoutRef.current);
      }
    };
  }, [itemCount]);

  // Continuous background auto-drift animation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let requestId: number;
    const scrollSpeed = 0.5;

    const scroll = (): void => {
      if (!isPaused && !isDraggingRef.current) {
        container.scrollTop += scrollSpeed;
        checkLoopBoundary(container);
      }

      const rect = container.getBoundingClientRect();
      const hotZone = rect.top + rect.height / 3;
      const bubbles = Array.from(container.children) as HTMLElement[];
      let foundIdx = -1;

      for (let i = 0; i < bubbles.length; i++) {
        const bubbleRect = bubbles[i].getBoundingClientRect();
        if (bubbleRect.top <= hotZone && bubbleRect.bottom >= hotZone) {
          foundIdx = i % itemCount;
          break;
        }
      }
      setActiveIdx(foundIdx);

      requestId = requestAnimationFrame(scroll);
    };

    requestId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(requestId);
  }, [isPaused, itemCount]);

  return {
    containerRef,
    activeIdx,
    isPaused,
    setIsPaused,
  };
};
