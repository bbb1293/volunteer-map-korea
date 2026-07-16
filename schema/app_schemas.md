# Volunteer Map Korea - Data Schemas

This document defines the core data schemas used in the application. Since we do not have a database for the hackathon (using 1365 API + localStorage), these represent TypeScript interfaces.

## 1. Volunteer Event (App Domain Model)

This is the normalized model our Next.js backend sends to the frontend, transformed from the raw 1365 XML response.

```typescript
interface VolunteerEvent {
  id: string;             // 1365 API unique ID (progrmRegistNo)
  title: string;          // Original Korean title
  translatedTitle?: string; // Gemini-translated title (added server-side)
  organization: string;   // Organization name (nanmmbyNm)
  category: string;       // Category (srvcClCode) e.g., 'Environment'
  status: 'Recruiting' | 'Closed';
  startDate: string;      // YYYY-MM-DD
  endDate: string;        // YYYY-MM-DD
  location: {
    lat: number;
    lng: number;
    address: string;
  };
  rawDescription?: string; // Only fetched/used for the popup
}
```

## 2. Gemini Translation Response

The expected JSON output from the `/api/translate` endpoint.

```typescript
interface TranslationResult {
  title: string;
  summary: string;
  requirements: string[];
  contactInfo: string;
}
```

## 3. Local Storage Schema (Gamification)

To store user impact without a database, we use the browser's `localStorage` under the key `volunteer_map_user_state`.

```json
{
  "completedEvents": [
    "1365-abc1234",
    "1365-def5678"
  ],
  "badges": [
    {
      "id": "first_event",
      "name": "First Step",
      "earnedAt": "2026-07-16T10:00:00Z"
    }
  ],
  "profileStats": {
    "totalHours": 8,
    "eventsJoined": 2
  }
}
```
