import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  Lock,
  Globe,
  Filter,
  BarChart3,
  Edit3,
  Zap,
  Cpu,
  MonitorSmartphone
} from "lucide-react";

const INTRO_ITEMS = [
  { icon: ShieldCheck, colorClass: "text-blue-500", titleKey: "intro.item1Title", descKey: "intro.item1Desc" },
  { icon: Lock, colorClass: "text-purple-500", titleKey: "intro.item2Title", descKey: "intro.item2Desc" },
  { icon: Globe, colorClass: "text-green-500", titleKey: "intro.item3Title", descKey: "intro.item3Desc" },
  { icon: Filter, colorClass: "text-orange-500", titleKey: "intro.item4Title", descKey: "intro.item4Desc" },
  { icon: BarChart3, colorClass: "text-red-500", titleKey: "intro.item5Title", descKey: "intro.item5Desc" },
  { icon: Zap, colorClass: "text-yellow-500", titleKey: "intro.item6Title", descKey: "intro.item6Desc" },
  { icon: Cpu, colorClass: "text-cyan-500", titleKey: "intro.item7Title", descKey: "intro.item7Desc" },
  { icon: MonitorSmartphone, colorClass: "text-indigo-500", titleKey: "intro.item9Title", descKey: "intro.item9Desc" },
  { icon: Edit3, colorClass: "text-pink-500", titleKey: "intro.item8Title", descKey: "intro.item8Desc" },
];

/**
 * ScrollingIntro component renders a scrolling carousel of features and key introductory points.
 * It dynamically tracks which item is currently passing through the center focus zone to highlight it.
 *
 * @returns React elements representing the scrolling feature sidebar.
 */
export const ScrollingIntro: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let requestId: number;
    const scrollSpeed = 0.6;
    const scroll = () => {
      const bubbles = Array.from(container.children) as HTMLElement[];
      if (bubbles.length >= INTRO_ITEMS.length * 3) {
        const y0 = bubbles[0].offsetTop;
        const yN = bubbles[INTRO_ITEMS.length].offsetTop;
        const loopHeight = yN - y0;

        if (loopHeight > 0) {
          if (!isPaused) {
            container.scrollTop += scrollSpeed;
          }

          if (container.scrollTop >= loopHeight * 2) {
            container.scrollTop -= loopHeight;
          } else if (container.scrollTop < loopHeight) {
            container.scrollTop += loopHeight;
          }
        }
      }

      const rect = container.getBoundingClientRect();
      const hotZone = rect.top + rect.height / 3;
      const bubblesForFocus = Array.from(container.children);
      let foundIdx = -1;
      for (let i = 0; i < bubblesForFocus.length; i++) {
        const bubbleRect = bubblesForFocus[i].getBoundingClientRect();
        if (bubbleRect.top <= hotZone && bubbleRect.bottom >= hotZone) {
          foundIdx = i % INTRO_ITEMS.length;
          break;
        }
      }
      setActiveIdx(foundIdx);
      requestId = requestAnimationFrame(scroll);
    };
    requestId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(requestId);
  }, [isPaused]);

  const displayItems = [...INTRO_ITEMS, ...INTRO_ITEMS, ...INTRO_ITEMS];

  return (
    <div
      className="flex flex-col h-full overflow-y-auto no-scrollbar py-[50vh] px-8 lg:px-16 relative select-none cursor-grab active:cursor-grabbing bg-transparent"
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onMouseDown={() => setIsPaused(true)}
      onMouseUp={() => setIsPaused(false)}
      style={{ scrollbarWidth: "none" }}
    >
      {displayItems.map((item, idx) => {
        const isActive = idx % INTRO_ITEMS.length === activeIdx;
        const IconComponent = item.icon;
        const displayIdx = ((idx % INTRO_ITEMS.length) + 1).toString().padStart(2, "0");
        return (
          <div key={idx} className={`transition-all duration-700 ease-in-out shrink-0 border-l-4 mb-8 ${isActive ? "border-blue-600 pl-8 scale-105 opacity-100" : "border-gray-200 dark:border-gray-800 pl-6 opacity-30 grayscale"}`}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className={`font-mono text-xs font-bold tracking-widest ${isActive ? "text-blue-600" : "text-gray-400"}`}>/{displayIdx}</span>
                <div className={`transition-transform duration-700 ${isActive ? "rotate-0 scale-110" : "rotate-12 opacity-50"}`}><IconComponent size={24} className={item.colorClass} /></div>
              </div>
              <div className="space-y-2">
                <h2 className={`text-4xl font-black leading-none tracking-tighter uppercase transition-colors duration-500 ${isActive ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-700"}`}>{t(item.titleKey)}</h2>
                <p className={`max-w-md text-lg font-medium leading-snug transition-colors duration-500 ${isActive ? "text-gray-600 dark:text-gray-400" : "text-transparent"}`}>{t(item.descKey)}</p>
              </div>
              {isActive && <div className="flex gap-1 mt-2 transition-all duration-500"><div className="h-1 w-2 bg-gray-200 dark:bg-gray-800" /></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};
