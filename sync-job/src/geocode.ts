export async function geocodeAddress(
  address: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`;
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
      const loc = data.results[0].geometry.location;
      if (typeof loc.lat === 'number' && typeof loc.lng === 'number') {
        return { lat: loc.lat, lng: loc.lng };
      }
    }
    return null;
  } catch {
    return null;
  }
}
