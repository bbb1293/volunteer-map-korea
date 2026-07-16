import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';

export async function POST(request: Request) {
  try {
    const { eventId, lang, title, organization } = await request.json();
    
    let eventTitle = title;
    let eventOrg = organization;
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
      });
    }

    const prompt = `Translate the following volunteer event info into ${lang || 'English'}. Return ONLY a JSON object with keys "title" and "organization", nothing else. Do not wrap the response in markdown blocks.
Title: ${eventTitle}
Organization: ${eventOrg}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
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
    });
  } catch (error) {
    console.error('Translation error:', error);
    return NextResponse.json({ error: 'Failed to translate' }, { status: 500 });
  }
}

function extractJSON(text: string): { title: string; organization?: string } {
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
