'use client';
import { useEffect, useRef, useState } from 'react';

interface VolunteerEvent {
  id: string;
  title: string;
  translatedTitle?: string;
  organization?: string;
  category?: string;
  status?: string;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}

export default function MapComponent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const mapInitialized = useRef(false);

  useEffect(() => {
    let active = true;
    let timerId: NodeJS.Timeout;

    const initMap = () => {
      if (
        mapRef.current &&
        !mapInitialized.current &&
        typeof google !== 'undefined' &&
        google.maps?.marker?.AdvancedMarkerElement
      ) {
        const newMap = new google.maps.Map(mapRef.current, {
          center: { lat: 37.5665, lng: 126.9780 },
          zoom: 12,
          mapId: process.env.NEXT_PUBLIC_MAP_ID || 'DEMO_MAP_ID',
        });
        setMap(newMap);
        mapInitialized.current = true;

        fetch('/api/volunteers')
          .then((res) => res.json())
          .then((data) => {
            if (!active) return;
            if (data && Array.isArray(data.events)) {
              data.events.forEach((event: VolunteerEvent) => {
                if (
                  event.location &&
                  typeof event.location.lat === 'number' &&
                  typeof event.location.lng === 'number'
                ) {
                  const marker = new google.maps.marker.AdvancedMarkerElement({
                    map: newMap,
                    position: { lat: event.location.lat, lng: event.location.lng },
                    title: event.translatedTitle || event.title,
                  });

                  marker.addListener('click', () => {
                    alert(`Clicked event: ${event.id}`);
                  });
                }
              });
            }
          })
          .catch((err) => {
            if (!active) return;
            console.error('Failed to fetch volunteer data:', err);
          });

        return true;
      }
      return mapInitialized.current;
    };

    if (!initMap()) {
      const checkGoogle = () => {
        if (!active) return;
        if (initMap()) return;
        timerId = setTimeout(checkGoogle, 100);
      };
      timerId = setTimeout(checkGoogle, 100);
    }

    return () => {
      active = false;
      if (timerId) clearTimeout(timerId);
    };
  }, []);

  return <div ref={mapRef} style={{ width: '100%', height: '100vh' }} />;
}
