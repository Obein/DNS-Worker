import { lazy } from "react";

export function lazyWithPreload<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  const factoryWithCatch = () =>
    factory().catch((err) => {
      const isChunkLoadFailed =
        err.message?.includes("Failed to fetch dynamically imported module") ||
        err.name === "TypeError" ||
        /dynamically imported module/i.test(err.message || "");
      if (isChunkLoadFailed) {
        const lastReload = sessionStorage.getItem("chunk_reload");
        const now = Date.now();
        if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
          sessionStorage.setItem("chunk_reload", now.toString());
          window.location.reload();
        }
      }
      throw err;
    });

  const Component = lazy(factoryWithCatch);
  (Component as any).preload = factoryWithCatch;
  return Component as unknown as T & { preload: () => Promise<{ default: T }> };
}
