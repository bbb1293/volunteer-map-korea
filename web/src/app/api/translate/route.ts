import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';

export async function POST(request: Request) {
  try {
    const { eventId, lang } = await request.json();
    const event = mockData.events.find((e: any) => e.id === eventId);
    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Fallback for development if API key is not configured
      return NextResponse.json({
        title: event.translatedTitle || event.title,
        organization: event.organization,
      });
    }

    const prompt = `Translate the following volunteer event info into ${lang || 'English'}. Return ONLY a JSON object with keys "title" and "organization", nothing else. Do not wrap the response in markdown blocks.
Title: ${event.title}
Organization: ${event.organization}`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

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

    const result = JSON.parse(text);
    return NextResponse.json({
      title: result.title,
      organization: result.organization,
    });
  } catch (error: any) {
    console.error('Translation error:', error);
    return NextResponse.json({ error: 'Failed to translate' }, { status: 500 });
  }
}
