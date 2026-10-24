import { useState, useEffect } from "react";

const CACHE_KEY = "obexdns_upstream_release_check_v2";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1-hour cache TTL to prevent hitting GitHub unauthenticated rate limits (60 req/hr)
const REQUEST_TIMEOUT_MS = 6000;

/**
 * Result returned by the useUpstreamUpdate hook.
 */
export interface UpstreamUpdateResult {
  /** True if the upstream GitHub repository has a newer release tag. */
  hasUpdate: boolean;
  /** The latest tag found in the upstream repository, if retrieved. */
  latestTag: string | null;
  /** The current application version string in `{git tag}-{commit hash}` format. */
  appVersion: string;
  /** The current git tag (e.g. "v1.1.5"). */
  gitTag: string;
  /** The current short git commit hash (e.g. "99a2e7b"). */
  gitCommit: string;
}

/**
 * Normalizes and compares two semantic version strings (e.g. "v1.1.4" and "v1.1.3.1").
 *
 * @param v1 - First version string.
 * @param v2 - Second version string.
 * @returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const parse = (v: string): number[] => {
    const clean = v.trim().replace(/^[vV]/, "").split("-")[0];
    return clean.split(".").map((n) => parseInt(n, 10) || 0);
  };

  const p1 = parse(v1);
  const p2 = parse(v2);
  const len = Math.max(p1.length, p2.length);

  for (let i = 0; i < len; i++) {
    const num1 = p1[i] ?? 0;
    const num2 = p2[i] ?? 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

/**
 * Reads initial cached state from localStorage synchronously during initialization.
 */
function getInitialCache(): {
  hasUpdate: boolean;
  latestTag: string | null;
  isExpired: boolean;
} {
  try {
    const cachedStr = localStorage.getItem(CACHE_KEY);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (
        cached &&
        typeof cached.checkedAt === "number" &&
        Date.now() - cached.checkedAt < CACHE_TTL_MS
      ) {
        return {
          hasUpdate: typeof cached.hasUpdate === "boolean" ? cached.hasUpdate : false,
          latestTag: typeof cached.latestTag === "string" ? cached.latestTag : null,
          isExpired: false,
        };
      }
    }
  } catch {
    // Defensive fallback: ignore localStorage failures (e.g. disabled in privacy mode)
  }
  return { hasUpdate: false, latestTag: null, isExpired: true };
}

/**
 * Hook to detect whether an upstream update is available on GitHub (Obein/DNS-Worker).
 * Caches results locally for 1 hour to respect rate limits and prevent page load delays.
 *
 * @returns An object containing `hasUpdate`, `latestTag`, and `appVersion`.
 */
export function useUpstreamUpdate(): UpstreamUpdateResult {
  const currentTag =
    typeof __APP_GIT_TAG__ !== "undefined" && __APP_GIT_TAG__
      ? __APP_GIT_TAG__
      : "v0.0.0";
  const currentCommit =
    typeof __APP_GIT_COMMIT__ !== "undefined" && __APP_GIT_COMMIT__
      ? __APP_GIT_COMMIT__
      : "dev";
  const appVersion =
    typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__
      ? __APP_VERSION__
      : `${currentTag}-${currentCommit}`;

  const [initialCache] = useState(getInitialCache);
  const [hasUpdate, setHasUpdate] = useState<boolean>(initialCache.hasUpdate);
  const [latestTag, setLatestTag] = useState<string | null>(initialCache.latestTag);

  useEffect(() => {
    if (!initialCache.isExpired) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    async function checkUpstream(): Promise<void> {
      try {
        let upstreamTag: string | null = null;
        let isNewer = false;

        // Strictly check GitHub releases tag_name
        const releaseRes = await fetch(
          "https://api.github.com/repos/Obein/DNS-Worker/releases/latest",
          {
            signal: controller.signal,
            headers: { Accept: "application/vnd.github.v3+json" },
          },
        );

        if (releaseRes.ok) {
          const data = (await releaseRes.json()) as { tag_name?: string };
          if (data && typeof data.tag_name === "string") {
            upstreamTag = data.tag_name;
            if (compareVersions(upstreamTag, currentTag) > 0) {
              isNewer = true;
            }
          }
        } else if (releaseRes.status === 404) {
          // If latest release is 404 (e.g. only pre-releases exist), check releases list
          const releasesRes = await fetch(
            "https://api.github.com/repos/Obein/DNS-Worker/releases?per_page=1",
            {
              signal: controller.signal,
              headers: { Accept: "application/vnd.github.v3+json" },
            },
          );
          if (releasesRes.ok) {
            const releases = (await releasesRes.json()) as Array<{ tag_name?: string }>;
            if (Array.isArray(releases) && releases.length > 0 && typeof releases[0]?.tag_name === "string") {
              upstreamTag = releases[0].tag_name;
              if (compareVersions(upstreamTag, currentTag) > 0) {
                isNewer = true;
              }
            }
          }
        }

        if (!isMounted) return;

        setHasUpdate(isNewer);
        if (upstreamTag) setLatestTag(upstreamTag);

        try {
          localStorage.setItem(
            CACHE_KEY,
            JSON.stringify({
              hasUpdate: isNewer,
              latestTag: upstreamTag,
              checkedAt: Date.now(),
            }),
          );
        } catch {
          // Ignore localStorage errors
        }
      } catch {
        // Silently catch network failures or aborts to maintain offline functionality
      } finally {
        clearTimeout(timeoutId);
      }
    }

    checkUpstream();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [currentTag, initialCache.isExpired]);

  return {
    hasUpdate,
    latestTag,
    appVersion,
    gitTag: currentTag,
    gitCommit: currentCommit,
  };
}
