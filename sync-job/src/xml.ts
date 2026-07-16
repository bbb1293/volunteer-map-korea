export function decodeXmlEntities(str: string): string {
  let val = str.trim();
  const cdataMatch = val.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/\r\n|\r/g, '\n')
    .trim();
}

export function extractTagValue(xml: string, tagName: string): string {
  const regex = new RegExp('<' + tagName + '\\b[^>]*>([\\s\\S]*?)</' + tagName + '>', 'i');
  const match = xml.match(regex);
  if (!match) return '';
  return decodeXmlEntities(match[1]);
}

export function extractItems(xml: string): string[] {
  const items: string[] = [];
  const itemRegex = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    items.push(match[1]);
  }
  return items;
}

export function formatDate(raw: string | undefined): string | undefined {
  if (!raw || raw.length !== 8) return undefined;
  return `${raw.slice(0, 4)}.${raw.slice(4, 6)}.${raw.slice(6, 8)}`;
}

export function formatTime(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const hour = parseInt(raw, 10);
  if (isNaN(hour) || hour < 0 || hour > 24) return undefined;
  return `${String(hour).padStart(2, '0')}:00`;
}

export function parseAreaLalo(raw: string | undefined): { lat: number; lng: number } | null {
  if (!raw) return null;
  const parts = raw.split(/[,;\s]+/).map((p) => parseFloat(p)).filter((n) => !isNaN(n));
  if (parts.length < 2) return null;
  const [lat, lng] = parts;
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return null;
  return { lat, lng };
}
