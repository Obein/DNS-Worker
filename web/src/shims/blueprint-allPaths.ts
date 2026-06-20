/**
 * Shim for @blueprintjs/icons/lib/esm/allPaths.js
 *
 * Replaces the static barrel that pulls in ALL icon SVG path data
 * (16px/paths and 20px/paths) into the initial bundle.
 *
 * With this shim in place:
 * - `IconSvgPaths16` / `IconSvgPaths20` are empty objects (they are legacy
 *   APIs; Blueprint's Icon component uses `Icons.getPaths()` instead).
 * - `getIconPaths` returns `undefined`, consistent with icons not yet loaded.
 *
 * Actual icon data is loaded on demand via the `splitPathsBySizeLoader`
 * dynamic loader configured via `Icons.setLoaderOptions` in main.tsx.
 */

// Legacy static exports — kept as empty objects so that code that
// destructures or indexes these records does not throw at runtime.
export const IconSvgPaths16: Record<string, string[]> = {};
export const IconSvgPaths20: Record<string, string[]> = {};

/**
 * Stub of the static `getIconPaths` helper.
 * Returns `undefined` when icons have not been pre-loaded statically,
 * which is correct when using the dynamic Icons loader.
 */
export function getIconPaths(_name: string, _size: number): string[] | undefined {
  return undefined;
}

/**
 * @deprecated use `getIconPaths` instead
 */
export function iconNameToPathsRecordKey(name: string): string {
  // Inline the minimal pascalCase transform to avoid statically importing change-case.
  return name
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase())
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}
