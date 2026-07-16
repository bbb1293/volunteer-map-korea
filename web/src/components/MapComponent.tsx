'use client';
import { useEffect, useRef, useState } from 'react';

export default function MapComponent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const mapInitialized = useRef(false);

  useEffect(() => {
    let active = true;
    let timerId: NodeJS.Timeout;

    const initMap = () => {
      if (mapRef.current && !mapInitialized.current && typeof google !== 'undefined') {
        const newMap = new google.maps.Map(mapRef.current, {
          center: { lat: 37.5665, lng: 126.9780 },
          zoom: 12,
          mapId: process.env.NEXT_PUBLIC_MAP_ID || 'DEMO_MAP_ID',
        });
        setMap(newMap);
        mapInitialized.current = true;
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
  }, []); // Empty dependency array prevents re-execution on state changes

  return <div ref={mapRef} style={{ width: '100%', height: '100vh' }} />;
}
