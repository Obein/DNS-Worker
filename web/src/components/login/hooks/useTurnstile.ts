import { useState, useEffect, useRef } from "react";
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
  onError: (msg: string) => void;
  /** Callback to clear parent error message */
  onClearError: () => void;
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

  useEffect(() => {
    if (
      isActive &&
      enabled &&
      siteKey &&
      (turnstileReady || window.turnstile) &&
      turnstileRef.current
    ) {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        setTurnstileStatus("verifying");
        turnstileRef.current.innerHTML = "";
        const widgetId = window.turnstile.render(turnstileRef.current, {
          sitekey: siteKey,
          callback: (token: string) => {
            setTurnstileToken(token);
            setTurnstileStatus("success");
            onClearError();
          },
          "expired-callback": () => {
            setTurnstileToken(null);
            setTurnstileStatus("idle");
          },
          "error-callback": (err: unknown) => {
            console.error("Turnstile error:", err);
            setTurnstileStatus("error");
            onError(
              t(
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
    }

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [isActive, enabled, siteKey, turnstileReady, t, onError, onClearError]);

  const resetTurnstile = () => {
    if (window.turnstile && widgetIdRef.current) {
      window.turnstile.reset(widgetIdRef.current);
    }
    setTurnstileToken(null);
    setTurnstileStatus("idle");
  };

  return {
    turnstileToken,
    setTurnstileToken,
    turnstileStatus,
    turnstileRef,
    resetTurnstile
  };
}
