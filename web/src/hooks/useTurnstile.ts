import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";

export interface UseTurnstileProps {
  /** Turnstile site key from auth configuration */
  siteKey?: string;
  /** Whether Turnstile verification is enabled for the current action */
  enabled?: boolean;
  /** Whether the Turnstile external script has loaded */
  turnstileReady: boolean;
  /** Whether Turnstile is currently required (e.g. only in Step 1) */
  isActive: boolean;
  /** Callback to set parent error message */
  onError?: (msg: string) => void;
  /** Callback to clear parent error message */
  onClearError?: () => void;
}

export interface UseTurnstileReturn {
  turnstileToken: string | null;
  setTurnstileToken: React.Dispatch<React.SetStateAction<string | null>>;
  turnstileStatus: "idle" | "verifying" | "success" | "error";
  turnstileRef: React.RefObject<HTMLDivElement | null>;
  resetTurnstile: () => void;
}

/**
 * Hook to manage Cloudflare Turnstile widget rendering, token state, and teardown.
 * Prevents redundant re-renders and re-verifications when callbacks or parent state change.
 */
export function useTurnstile({
  siteKey,
  enabled,
  turnstileReady,
  isActive,
  onError,
  onClearError
}: UseTurnstileProps): UseTurnstileReturn {
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<
    "idle" | "verifying" | "success" | "error"
  >("idle");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  const { t } = useTranslation();

  // Store callbacks and t in refs so their identity changes never trigger widget re-mounts
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onClearErrorRef = useRef(onClearError);
  onClearErrorRef.current = onClearError;
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => {
    // If not active, or not enabled, or missing siteKey:
    // Teardown any existing widget and reset state.
    if (!isActive || !enabled || !siteKey) {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (e) {
          console.error("Turnstile remove error:", e);
        }
        widgetIdRef.current = null;
      }
      setTurnstileToken(null);
      setTurnstileStatus("idle");
      return;
    }

    // Wait until Turnstile SDK is loaded and container element exists
    if (!(turnstileReady || window.turnstile) || !turnstileRef.current) {
      return;
    }

    // If widget is ALREADY rendered and active, do NOT re-render!
    if (widgetIdRef.current) {
      return;
    }

    try {
      setTurnstileStatus("verifying");
      turnstileRef.current.innerHTML = "";
      const widgetId = window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          setTurnstileToken(token);
          setTurnstileStatus("success");
          onClearErrorRef.current?.();
        },
        "expired-callback": () => {
          setTurnstileToken(null);
          setTurnstileStatus("idle");
        },
        "error-callback": (err: unknown) => {
          console.error("Turnstile error:", err);
          setTurnstileStatus("error");
          onErrorRef.current?.(
            tRef.current(
              "auth.turnstileError",
              "Verification service failed to load. Please reload and try again."
            )
          );
          setTurnstileToken(null);
        }
      });
      widgetIdRef.current = widgetId;
    } catch (e) {
      console.error("Turnstile render error:", e);
      setTurnstileStatus("error");
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (e) {
          console.error("Turnstile cleanup error:", e);
        }
        widgetIdRef.current = null;
      }
    };
  }, [isActive, enabled, siteKey, turnstileReady]);

  const resetTurnstile = useCallback(() => {
    if (window.turnstile && widgetIdRef.current) {
      try {
        window.turnstile.reset(widgetIdRef.current);
      } catch (e) {
        console.error("Turnstile reset error:", e);
      }
    }
    setTurnstileToken(null);
    setTurnstileStatus("idle");
  }, []);

  return {
    turnstileToken,
    setTurnstileToken,
    turnstileStatus,
    turnstileRef,
    resetTurnstile
  };
}
