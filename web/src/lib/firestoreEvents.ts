import type { Firestore } from '@google-cloud/firestore';
import { getFirestoreClient } from './firestoreClient.ts';
import type { VolunteerEvent } from '../types/volunteerEvent.ts';

export interface BoundingBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

export function parseBoundingBox(searchParams: URLSearchParams): BoundingBox | null {
  const raw = {
    swLat: searchParams.get('swLat'),
    swLng: searchParams.get('swLng'),
    neLat: searchParams.get('neLat'),
    neLng: searchParams.get('neLng'),
  };
  if (!raw.swLat || !raw.swLng || !raw.neLat || !raw.neLng) return null;

  const parsed = {
    swLat: parseFloat(raw.swLat),
    swLng: parseFloat(raw.swLng),
    neLat: parseFloat(raw.neLat),
    neLng: parseFloat(raw.neLng),
  };
  if (Object.values(parsed).some((n) => isNaN(n))) return null;
  return parsed;
}

export async function queryEventsInBounds(bbox: BoundingBox, db: Firestore = getFirestoreClient()): Promise<VolunteerEvent[]> {
  const snapshot = await db
    .collection('volunteerEvents')
    .where('lat', '>=', bbox.swLat)
    .where('lat', '<=', bbox.neLat)
    .where('lng', '>=', bbox.swLng)
    .where('lng', '<=', bbox.neLng)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      title: data.title,
      organization: data.organization,
      category: data.category,
      status: data.status,
      startDate: data.startDate,
      endDate: data.endDate,
      startTime: data.startTime,
      endTime: data.endTime,
      recruitStartDate: data.recruitStartDate,
      recruitEndDate: data.recruitEndDate,
      externalUrl: data.externalUrl,
      description: data.description,
      spotsNeeded: data.spotsNeeded,
      spotsFilled: data.spotsFilled,
      adultPosblAt: data.adultPosblAt,
      familyPosblAt: data.familyPosblAt,
      grpPosblAt: data.grpPosblAt,
      pbsvntPosblAt: data.pbsvntPosblAt,
      yngbgsPosblAt: data.yngbgsPosblAt,
      actWkdy: data.actWkdy,
      email: data.email,
      telno: data.telno,
      location:
        typeof data.lat === 'number' && typeof data.lng === 'number'
          ? { lat: data.lat, lng: data.lng, address: data.address }
          : undefined,
    };
  });
}
