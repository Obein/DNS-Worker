import React from "react";
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
import type { LucideIcon } from "lucide-react";
import { useScrollingIntro } from "../hooks/useScrollingIntro";

interface IntroItem {
  icon: LucideIcon;
  colorClass: string;
  titleKey: string;
  descKey: string;
}

const INTRO_ITEMS: IntroItem[] = [
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
 * @returns {React.ReactElement} React elements representing the scrolling feature sidebar.
 */
export const ScrollingIntro: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const { containerRef, activeIdx, setIsPaused } = useScrollingIntro({ itemCount: INTRO_ITEMS.length });

  const displayItems = [...INTRO_ITEMS, ...INTRO_ITEMS, ...INTRO_ITEMS];

  return (
    <div
      className="flex flex-col h-full overflow-y-auto no-scrollbar py-[50vh] px-8 lg:px-16 relative select-none cursor-grab active:cursor-grabbing bg-transparent"
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      style={{ scrollbarWidth: "none" }}
    >
      {displayItems.map((item, idx) => {
        const isActive = idx % INTRO_ITEMS.length === activeIdx;
        const IconComponent = item.icon;
        const displayIdx = ((idx % INTRO_ITEMS.length) + 1).toString().padStart(2, "0");
        return (
          <div
            key={idx}
            className={`transition-[opacity,transform,border-color,filter] duration-300 ease-out shrink-0 border-l-4 mb-8 pl-6 transform-gpu ${
              isActive
                ? "border-blue-600 scale-[1.03] opacity-100 grayscale-0"
                : "border-gray-200 dark:border-gray-800 scale-100 opacity-30 grayscale"
            }`}
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span
                  className={`font-mono text-xs font-bold tracking-widest transition-colors duration-300 ${
                    isActive ? "text-blue-600" : "text-gray-400"
                  }`}
                >
                  /{displayIdx}
                </span>
                <div
                  className={`transition-transform duration-300 ${
                    isActive ? "rotate-0 scale-110" : "rotate-12 opacity-50"
                  }`}
                >
                  <IconComponent size={24} className={item.colorClass} />
                </div>
              </div>
              <div className="space-y-2">
                <h2
                  className={`text-4xl font-black leading-none tracking-tighter uppercase transition-colors duration-300 ${
                    isActive ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-700"
                  }`}
                >
                  {t(item.titleKey)}
                </h2>
                <p
                  className={`max-w-md text-lg font-medium leading-snug transition-colors duration-300 ${
                    isActive ? "text-gray-600 dark:text-gray-400" : "text-transparent"
                  }`}
                >
                  {t(item.descKey)}
                </p>
              </div>
              {isActive && (
                <div className="flex gap-1 mt-2 transition-all duration-300">
                  <div className="h-1 w-2 bg-gray-200 dark:bg-gray-800" />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
