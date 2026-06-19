import i18n from "../i18n/config";
import { loadLocale } from "../i18n/config";
import { setSystemLocale } from "./date";

/**
 * Updates the application locale and persists the change to the user account if logged in.
 *
 * The locale bundle is fetched (and cached) before `i18n.changeLanguage` is
 * called, so the UI never reverts to the fallback language mid-render.
 *
 * @param newLocale - The new locale code to set.
 * @returns A promise resolving to `{ loaded, persisted }`:
 *   - `loaded`:    true if the locale bundle was available (cached or just downloaded).
 *   - `persisted`: true if the server PATCH succeeded.
 */
export async function updateLocale(
  newLocale: string,
): Promise<{ loaded: boolean; persisted: boolean }> {
  const locale = newLocale || "en-US";

  // Fetch and cache the locale bundle BEFORE switching the language.
  // For English variants (en-GB, en-SG) loadLocale returns false (no separate
  // bundle), which is fine — they share the bundled en-US translations.
  const loaded = await loadLocale(locale);

  // Switch the language only after the bundle is ready.
  i18n.changeLanguage(locale);
  setSystemLocale(locale);

  // Persist the preference to the server in the background.
  try {
    const res = await fetch("/api/account/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locale }),
    });
    return { loaded, persisted: res.ok };
  } catch (e) {
    console.error("Failed to persist locale to server:", e);
    return { loaded, persisted: false };
  }
}
