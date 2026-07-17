import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';
import { parseBoundingBox, queryEventsInBounds } from '@/lib/firestoreEvents';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const bbox = parseBoundingBox(searchParams);

  if (!bbox) {
    return NextResponse.json({ error: 'swLat, swLng, neLat, neLng query params are required' }, { status: 400 });
  }

  try {
    const events = await queryEventsInBounds(bbox);
    return NextResponse.json({ events });
  } catch (error) {
    console.error('Firestore query failed. Falling back to mock data. Error:', error);
    return NextResponse.json(mockData);
  }
}
