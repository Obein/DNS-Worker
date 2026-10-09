import { useMemo } from "react";
import type { DeploymentMode } from "../types/system";

export interface DeploymentModeResult {
  mode: DeploymentMode;
  isServerfull: boolean;
  isCloudflare: boolean;
}

/**
 * Hook to inspect the active deployment mode (Serverfull vs Cloudflare Workers).
 * Sources status from window.DNS_WORKER_CONFIG injected by HTMLRewriter.
 */
export function useDeploymentMode(): DeploymentModeResult {
  return useMemo(() => {
    const config = typeof window !== "undefined" ? window.DNS_WORKER_CONFIG : undefined;
    const isServerfull = Boolean(
      config?.isServerfull ||
      config?.mode === "serverfull"
    );
    const mode: DeploymentMode = isServerfull ? "serverfull" : "cloudflare";

    return {
      mode,
      isServerfull,
      isCloudflare: !isServerfull,
    };
  }, []);
}
