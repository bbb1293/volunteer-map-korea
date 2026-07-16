import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';

export async function POST(request: Request) {
  try {
    const { eventId, lang, title, organization, address } = await request.json();

    let eventTitle = title;
    let eventOrg = organization;
    let eventAddress = address;
    let fallbackTranslatedTitle: string | undefined = undefined;

    if (!eventTitle) {
      const event = mockData.events.find((e: { id: string; translatedTitle?: string; title: string; organization?: string }) => e.id === eventId);
      if (!event) {
        return NextResponse.json({ error: 'Event not found' }, { status: 404 });
      }
      eventTitle = event.title;
      eventOrg = event.organization;
      fallbackTranslatedTitle = event.translatedTitle;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback for development if API key is not configured
      return NextResponse.json({
        title: fallbackTranslatedTitle || eventTitle,
        organization: eventOrg,
        address: eventAddress,
      });
    }

    const prompt = `Translate the following volunteer event info into ${lang || 'English'}. Return ONLY a JSON object with keys "title", "organization", and "address", nothing else. Do not wrap the response in markdown blocks. Keep proper nouns/place names transliterated naturally rather than literally word-for-word.
Title: ${eventTitle}
Organization: ${eventOrg}
Address: ${eventAddress || ''}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    // Gemini's JSON-mode output is intermittently malformed/empty even with
    // thinking disabled below; retry a couple of times before giving up.
    const MAX_ATTEMPTS = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              // A plain translation doesn't need extended reasoning; without
              // this, thinking tokens can consume the output budget and leave
              // the actual answer empty/truncated.
              thinkingConfig: { thinkingBudget: 0 },
            }
          }),
        });

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          throw new Error('Invalid response from Gemini');
        }

        const result = extractJSON(text);
        return NextResponse.json({
          title: result.title,
          organization: result.organization,
          address: result.address,
        });
      } catch (err) {
        lastError = err;
        console.warn(`Translation attempt ${attempt}/${MAX_ATTEMPTS} failed:`, err);
      }
    }

    throw lastError;
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json({ error: 'Failed to translate' }, { status: 500 });
  }
}

function extractJSON(text: string): { title: string; organization?: string; address?: string } {
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) {
    throw new Error('No JSON object found in response');
  }
  
  const lastBrace = text.lastIndexOf('}');
  if (lastBrace === -1) {
    throw new Error('No JSON object found in response');
  }
  
  let currentEnd = lastBrace;
  while (currentEnd >= firstBrace) {
    const candidate = text.substring(firstBrace, currentEnd + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      currentEnd = text.lastIndexOf('}', currentEnd - 1);
    }
  }
  
  throw new Error('Could not parse a valid JSON object from response');
}
