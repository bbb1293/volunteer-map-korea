import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';

// In-memory geocoding cache to avoid redundant expensive API lookups
const geocodeCache = new Map<string, { lat: number; lng: number } | null>();

// Each listing requires its own detail-endpoint call for coordinates, and
// dev-tier data.go.kr keys are quota-limited (~1,000 req/day). A 2-hour cache
// keeps a 100-item batch (101 requests/refresh) well within that budget while
// still refreshing often enough for a live demo.
const EVENTS_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
let eventsCache: { events: unknown[]; fetchedAt: number } | null = null;

// 행정안전부_봉사참여정보서비스_GW (data.go.kr publicDataPk=15157582) returns the
// category as this Korean display text directly in srvcClCode (not a numeric code).
const CATEGORY_NAMES: Record<string, string> = {
  '생활편의': 'Living Support',
  '주거환경': 'Housing & Environment',
  '상담ㆍ멘토링': 'Counseling & Mentoring',
  '교육': 'Education',
  '보건ㆍ의료': 'Health & Medical',
  '농어촌 봉사': 'Rural Community',
  '문화ㆍ체육ㆍ예술ㆍ관광': 'Culture, Sports & Tourism',
  '환경ㆍ생태계보호': 'Environment',
  '사무행정': 'Administration',
  '지역안전ㆍ보호': 'Community Safety',
  '인권ㆍ공익': 'Human Rights & Public Interest',
  '재난ㆍ재해': 'Disaster Relief',
  '국제협력ㆍ해외봉사': 'International Cooperation',
  '기타': 'Other',
  '자원봉사 기본교육': 'Volunteer Basic Training',
  '온라인자원봉사': 'Online Volunteering',
};

// Parses the government API's "위도,경도" coordinate string (delimiter observed
// to vary, so accept comma/semicolon/whitespace) into { lat, lng }.
function parseAreaLalo(raw: string | undefined): { lat: number; lng: number } | null {
  if (!raw) return null;
  const parts = raw.split(/[,;\s]+/).map((p) => parseFloat(p)).filter((n) => !isNaN(n));
  if (parts.length < 2) return null;
  const [lat, lng] = parts;
  // Sanity-check against South Korea's bounding box.
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  return { lat, lng };
}

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

  // 1b. Serve from cache if it's still fresh, to stay within the daily API quota.
  if (eventsCache && Date.now() - eventsCache.fetchedAt < EVENTS_CACHE_TTL_MS) {
    return NextResponse.json({ events: eventsCache.events });
  }

  try {
    // 2. Fetch live volunteer opportunity XML listings via the data.go.kr gateway
    // (행정안전부_봉사참여정보서비스_GW, publicDataPk=15157582)
    const hasPercent = serviceKey.includes('%');
    const encodedKey = hasPercent ? serviceKey : encodeURIComponent(serviceKey);
    const baseUrl = 'https://apis.data.go.kr/1741000/volunteerPartcptnService';
    const url = `${baseUrl}/getVltrSearchWordList?serviceKey=${encodedKey}&numOfRows=100&pageNo=1`;

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

    // 5. Map opportunities: prefer the government's own coordinates (from the
    // per-item detail endpoint), falling back to Google geocoding of the address.
    const eventPromises = items.map(async (itemXml) => {
      const id = extractTagValue(itemXml, 'progrmRegistNo');
      const title = extractTagValue(itemXml, 'progrmSj');
      const organization = extractTagValue(itemXml, 'nanmmbyNm');
      const address = extractTagValue(itemXml, 'actPlace');
      const categoryCode = extractTagValue(itemXml, 'srvcClCode');
      const category = CATEGORY_NAMES[categoryCode] || categoryCode || 'Volunteer';

      if (!id || !title) {
        return null;
      }

      let coords: { lat: number; lng: number } | null = null;

      // Fetch official coordinates from the detail endpoint for this program.
      try {
        const detailUrl = `${baseUrl}/getVltrPartcptnItem?serviceKey=${encodedKey}&progrmRegistNo=${encodeURIComponent(id)}`;
        const detailResponse = await fetchWithTimeout(detailUrl, {}, 8000);
        if (detailResponse.ok) {
          const detailXml = await detailResponse.text();
          coords =
            parseAreaLalo(extractTagValue(detailXml, 'areaLalo1')) ||
            parseAreaLalo(extractTagValue(detailXml, 'areaLalo2')) ||
            parseAreaLalo(extractTagValue(detailXml, 'areaLalo3'));
        }
      } catch (error) {
        console.warn(`Failed to fetch detail/coordinates for program ${id}:`, error);
      }

      // Fall back to geocoding the address if the government data had no usable coordinates.
      if (!coords && address && googleKey) {
        coords = await geocodeAddress(address, googleKey);
      }

      // Skip items we could not place on the map at all.
      if (!coords) {
        return null;
      }

      return {
        id,
        title,
        organization: organization || undefined,
        category,
        status: 'Recruiting',
        location: {
          lat: coords.lat,
          lng: coords.lng,
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

    eventsCache = { events, fetchedAt: Date.now() };
    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching/parsing 1365 volunteers data. Falling back to mock data. Error:', error);
    return NextResponse.json(mockData);
  }
}
