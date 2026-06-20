/**
 * Extracts coordinates from the request strictly using Cloudflare geo-IP.
 * Client headers are ignored to prevent geolocation spoofing.
 */
export function getRequestCoordinates(request: Request): { latitude: number | null; longitude: number | null } {
  // Try Cloudflare Workers context cf object
  const cf = (request as any).cf;
  if (cf && cf.latitude && cf.longitude) {
    const lat = parseFloat(cf.latitude);
    const lon = parseFloat(cf.longitude);
    if (!isNaN(lat) && !isNaN(lon)) {
      return { latitude: lat, longitude: lon };
    }
  }

  // Fallback to Cloudflare-injected headers
  const headerLat = request.headers.get("CF-IPLatitude");
  const headerLon = request.headers.get("CF-IPLongitude");
  if (headerLat && headerLon) {
    const lat = parseFloat(headerLat);
    const lon = parseFloat(headerLon);
    if (!isNaN(lat) && !isNaN(lon)) {
      return { latitude: lat, longitude: lon };
    }
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
