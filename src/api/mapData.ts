import { Env, ExecutionContext } from '../types';

/**
 * Intercepts /world-110m.json requests, fetches map topology from openlayers.org,
 * transforms numeric ids to 3-digit padded string IDs for client-side country code lookup compatibility,
 * and caches the response on Cloudflare Edge nodes for 30 days (1 month).
 */
export async function handleMapDataRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const cacheKey = new Request(new URL('https://obex.local/world-110m-v2.json'), request);
  const cache = (caches as any).default;

  let response = await cache.match(cacheKey);
  if (!response) {
    try {
      const url = 'https://openlayers.org/en/latest/examples/data/topojson/world-110m.json';
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'DNS Worker/1.0 (Cloudflare Worker Map Proxy)'
        }
      });
      if (!res.ok) {
        throw new Error(`Failed to fetch map data from openlayers.org: ${res.status}`);
      }

      const data = await res.json() as any;

      // Ensure "countries" is the first key in data.objects because react-simple-maps
      // defaults to parsing the first key returned by Object.keys(data.objects).
      if (data && data.objects) {
        const sortedObjects: any = {};
        if (data.objects.countries) {
          sortedObjects.countries = data.objects.countries;
        }
        if (data.objects.land) {
          sortedObjects.land = data.objects.land;
        }
        data.objects = sortedObjects;
      }

      // Transform numeric IDs to 3-digit padded string IDs (e.g. 4 -> "004")
      // to match the keys of numericToAlpha2 mapping on the client side.
      if (data && data.objects && data.objects.countries && Array.isArray(data.objects.countries.geometries)) {
        data.objects.countries.geometries.forEach((geom: any) => {
          if (geom.id !== undefined && geom.id !== null) {
            geom.id = String(geom.id).padStart(3, '0');
          }
        });
      }

      response = new Response(JSON.stringify(data), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=2592000', // Cache for 30 days (1 month)
          'Access-Control-Allow-Origin': '*'
        }
      });

      // Cache the response
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } catch (e) {
      console.error('[MapData API Proxy] Error fetching or transforming TopoJSON:', e);
      return new Response(JSON.stringify({ error: 'Failed to fetch map data' }), {
        status: 502,
        headers: {
          'Content-Type': 'application/json'
        }
      });
    }
  }

  return response;
}
