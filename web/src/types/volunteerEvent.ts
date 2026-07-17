export interface VolunteerEvent {
  id: string;
  title: string;
  translatedTitle?: string;
  organization?: string;
  category?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  recruitStartDate?: string;
  recruitEndDate?: string;
  externalUrl?: string;
  description?: string;
  spotsNeeded?: number;
  spotsFilled?: number;
  adultPosblAt?: string;
  familyPosblAt?: string;
  grpPosblAt?: string;
  pbsvntPosblAt?: string;
  yngbgsPosblAt?: string;
  actWkdy?: string;
  email?: string;
  telno?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}
