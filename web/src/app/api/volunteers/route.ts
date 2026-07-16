import { NextResponse } from 'next/server';
import mockData from '@/data/seoul_volunteers.json';

export async function GET(request: Request) {
  // Hackathon logic: Start with mock data, we will add live API and Gemini batch later
  return NextResponse.json(mockData);
}
