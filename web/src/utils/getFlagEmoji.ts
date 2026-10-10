export function getFlagEmoji(countryCode?: string | null): string {
  if (!countryCode) return "🌐";
  const upper = countryCode.toUpperCase().trim();
  if (
    upper === "UNKNOWN" ||
    upper === "UN" ||
    upper === "XX" ||
    upper === "-" ||
    upper === "N/A"
  ) {
    return "🌐";
  }
  if (
    upper === "LAN" ||
    upper === "LOCAL" ||
    upper === "PRIVATE" ||
    upper === "PRIVATE NETWORK"
  ) {
    return "🏠";
  }
  if (upper.length !== 2) {
    return "🌐";
  }
  const codePoints = upper
    .split("")
    .map((char) => 127397 + char.charCodeAt(0));
  return String.fromCodePoint(...codePoints);
}
