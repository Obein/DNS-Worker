/**
 * Extracts coordinates from the request strictly using Cloudflare geo-IP.
 * Client headers are ignored to prevent geolocation spoofing.
 */
export function getRequestCoordinates(request: Request): { latitude: number | null; longitude: number | null } {
  // Only trust Cloudflare IP-based location
  const cf = (request as any).cf;
  if (cf && cf.latitude && cf.longitude) {
    const lat = parseFloat(cf.latitude);
    const lon = parseFloat(cf.longitude);
    if (!isNaN(lat) && !isNaN(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // Local loopback mock fallback for development
  const clientIp = request.headers.get("CF-Connecting-IP") || "";
  if (clientIp === "127.0.0.1" || clientIp === "::1" || clientIp === "") {
    return { latitude: 0, longitude: 0 };
  }

  return { latitude: null, longitude: null };
}

/**
 * Calculates the Haversine distance between two coordinates in kilometers.
 */
export function calculateDistanceInKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
