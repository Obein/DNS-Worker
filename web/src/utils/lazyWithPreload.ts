import { lazy } from "react";

export function lazyWithPreload<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
) {
  const Component = lazy(factory);
  (Component as any).preload = factory;
  return Component as unknown as T & { preload: () => Promise<{ default: T }> };
}
