/**
 * Formats a Date object to a localized string with a timezone offset suffix (e.g. "2026/6/1 14:20:03 UTC+8").
 *
 * @param date - The Date object to format.
 * @param options - Optional Intl.DateTimeFormatOptions to customize the format.
 * @returns The formatted date string with the timezone offset suffix.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

let systemTimeZone: string | undefined = undefined;
let systemLocale: string = typeof navigator !== "undefined" ? navigator.language : "en-US";

export function setSystemTimeZone(tz: string) {
  systemTimeZone = tz || undefined;
  formatterCache.clear();
}

export function setSystemLocale(locale: string) {
  systemLocale = locale || (typeof navigator !== "undefined" ? navigator.language : "en-US");
  formatterCache.clear();
}

function getFormatter(
  locale: string | undefined,
  options?: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${locale || ""}:${options ? JSON.stringify(options) : ""}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatDateTime(
  date: Date,
  options?: Intl.DateTimeFormatOptions
): string {
  const mergedOptions: Intl.DateTimeFormatOptions = {
    timeZone: systemTimeZone,
    timeZoneName: "short",
    ...(options || {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  };

  return getFormatter(systemLocale, mergedOptions).format(date);
}
