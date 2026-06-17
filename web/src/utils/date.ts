/**
 * Formats a Date object to a localized string with a timezone offset suffix (e.g. "2026/6/1 14:20:03 UTC+8").
 *
 * @param date - The Date object to format.
 * @param options - Optional Intl.DateTimeFormatOptions to customize the format.
 * @returns The formatted date string with the timezone offset suffix.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

let systemTimeZone: string | undefined = undefined;

export function setSystemTimeZone(tz: string) {
  systemTimeZone = tz;
  formatterCache.clear();
}

function getFormatter(options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = options ? JSON.stringify(options) : "";
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(undefined, options);
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
    ...options,
  };
  return getFormatter(mergedOptions).format(date);
}
