import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';

// In-memory geocoding cache to avoid redundant expensive API lookups
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

// Helper to decode basic XML entities and strip CDATA
function decodeXmlEntities(str: string): string {
  let val = str.trim();
  const cdataRegex = /<!\[CDATA\[([\s\S]*?)\]\]>/i;
  const cdataMatch = val.match(cdataRegex);
  if (cdataMatch) {
    val = cdataMatch[1].trim();
  }
  return val
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

// Extract tag value safely
function extractTagValue(xml: string, tagName: string): string {
  const regex = new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)</' + tagName + '>', 'i');
  const match = xml.match(regex);
  if (!match) return '';
  return decodeXmlEntities(match[1]);
}

// Fetch with timeout helper
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(id);
  }
}

// Geocode helper
async function geocodeAddress(address: string, googleKey: string): Promise<{ lat: number; lng: number } | null> {
  if (geocodeCache.has(address)) {
    return geocodeCache.get(address) ?? null;
  }
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
    const response = await fetchWithTimeout(url, {}, 5000);
    if (!response.ok) {
      console.warn(`Geocoding HTTP error: ${response.status} ${response.statusText}`);
      geocodeCache.set(address, null);
      return null;
    }
    const data = await response.json();
    if (data.status === 'OK' && data.results && data.results[0]?.geometry?.location) {
      const loc = data.results[0].geometry.location;
      if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        const coords = { lat: loc.lat, lng: loc.lng };
        geocodeCache.set(address, coords);
        return coords;
      }
    } else {
      console.warn(`Geocoding failed for address "${address}": status is ${data.status}`);
    }
  } catch (error) {
    console.error(`Geocoding exception for address "${address}":`, error);
  }
  geocodeCache.set(address, null);
  return null;
}

export async function GET() {
  const serviceKey = process.env.DATA_GO_KR_API_KEY;
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;

  // 1. If API key is not defined, fall back silently and cleanly to mock data
  if (!serviceKey) {
    console.log('DATA_GO_KR_API_KEY is not defined. Falling back to mock data.');
    return NextResponse.json(mockData);
  }

  try {
    // 2. Fetch live volunteer opportunity XML listings
    const hasPercent = serviceKey.includes('%');
    const url = `http://openapi.1365.go.kr/openapi/service/rest/VolunteerrecruitService/getVltrSearchWordList?serviceKey=${hasPercent ? serviceKey : encodeURIComponent(serviceKey)}&numOfRows=15`;

    const response = await fetchWithTimeout(url, {}, 10000); // 10s timeout for portal API
    if (!response.ok) {
      throw new Error(`1365 Portal HTTP error: ${response.status} ${response.statusText}`);
    }

    const xmlText = await response.text();

    // 3. Check for API error response codes in resultCode
    const resultCode = extractTagValue(xmlText, 'resultCode');
    const resultMsg = extractTagValue(xmlText, 'resultMsg');
    if (resultCode && resultCode !== '00' && resultCode !== '0000') {
      throw new Error(`1365 Portal returned error code ${resultCode}: ${resultMsg}`);
    }

    // 4. Parse XML items
    const items: string[] = [];
    const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemRegex.exec(xmlText)) !== null) {
      items.push(match[1]);
    }

    if (items.length === 0) {
      console.warn('No items found in 1365 XML response. Falling back to mock data.');
      return NextResponse.json(mockData);
    }

    // 5. Map opportunities and geocode addresses in parallel
    const eventPromises = items.map(async (itemXml) => {
      const id = extractTagValue(itemXml, 'progrmNo');
      const title = extractTagValue(itemXml, 'progrmSj');
      const organization = extractTagValue(itemXml, 'nanmmGroupNm');
      const address = extractTagValue(itemXml, 'actPlace');

      if (!id || !title) {
        return null;
      }

      let lat = 37.5665; // Default fallback to Seoul coordinates
      let lng = 126.978;
      let hasCoordinates = false;

      // Geocode address if google key and valid address are available
      if (address && googleKey) {
        const coords = await geocodeAddress(address, googleKey);
        if (coords) {
          lat = coords.lat;
          lng = coords.lng;
          hasCoordinates = true;
        }
      }

      // If geocoding was requested but failed to produce coordinates, we can either:
      // - Fall back to the address string but keep default coords
      // - Or skip this item entirely so we don't display markers at the exact same default point
      // Let's keep the item but place it or skip it based on whether we could geocode it when googleKey is provided.
      // Wait, if a key is provided, we should only display items on the map that successfully geocode.
      // If we cannot geocode them, skipping them ensures they don't pile up on the default coordinates of Seoul City Hall!
      if (googleKey && !hasCoordinates) {
        return null;
      }

      return {
        id,
        title,
        organization: organization || undefined,
        category: 'Volunteer',
        status: 'Recruiting',
        location: {
          lat,
          lng,
          address: address || undefined,
        },
      };
    });

    const events = (await Promise.all(eventPromises)).filter((e): e is NonNullable<typeof e> => e !== null);

    // If all events failed to geocode or parse, fall back to mock data
    if (events.length === 0) {
      console.warn('All parsed events lacked coordinates. Falling back to mock data.');
      return NextResponse.json(mockData);
    }

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching/parsing 1365 volunteers data. Falling back to mock data. Error:', error);
    return NextResponse.json(mockData);
  }
}
