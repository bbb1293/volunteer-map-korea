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

  const [selectedEvent, setSelectedEvent] = useState<VolunteerEvent | null>(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [clickedCount, setClickedCount] = useState(0);

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
                  typeof event.location.lat === 'number' && !isNaN(event.location.lat) &&
                  typeof event.location.lng === 'number' && !isNaN(event.location.lng)
                ) {
                  const pinContainer = document.createElement('div');
                  pinContainer.className = 'custom-map-pin';
                  const isEnv = event.category === 'Environment';
                  const pinColor = isEnv ? '#10b981' : '#8b5cf6';
                  pinContainer.style.setProperty('--pin-color', pinColor);

                  const svgIcon = isEnv
                    ? `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 8a8.5 8.5 0 0 1-9 10Z"></path><path d="M19 2c-2.26 4.33-5.27 7.14-8 10"></path></svg>`
                    : `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`;

                  pinContainer.innerHTML = `
                    <div class="pin-pulse" style="background-color: ${pinColor}"></div>
                    <div class="pin-core" style="background-color: ${pinColor}">
                      ${svgIcon}
                    </div>
                  `;

                  const marker = new google.maps.marker.AdvancedMarkerElement({
                    map: newMap,
                    position: { lat: event.location.lat, lng: event.location.lng },
                    title: event.translatedTitle || event.title,
                    content: pinContainer,
                  });

                  marker.addListener('click', () => {
                    setSelectedEvent(event);
                    setClickedCount((prev) => prev + 1);
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
      mapInitialized.current = false; // Reset to support Strict Mode remounts
    };
  }, []);

  const handleTranslate = async () => {
    if (!selectedEvent) return;
    setIsTranslating(true);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventId: selectedEvent.id,
          lang: 'English',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setSelectedEvent((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            title: data.title,
            organization: data.organization,
          };
        });
      } else {
        console.error('Translation failed');
      }
    } catch (err) {
      console.error('Error during translation:', err);
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Gamification Badges Overlay */}
      <div className="badge-overlay">
        <h3 className="badge-overlay-title">Volunteer Impact Badges</h3>
        {clickedCount >= 1 ? (
          <div className="badge-item unlocked">
            <div className="badge-icon">🌟</div>
            <div className="badge-info">
              <span className="badge-name">Seoul Explorer</span>
              <span className="badge-desc">Discovered your first volunteer opportunity!</span>
            </div>
          </div>
        ) : (
          <div className="badge-item locked">
            <div className="badge-icon">🔒</div>
            <div className="badge-info">
              <span className="badge-name">Seoul Explorer</span>
              <span className="badge-desc">Click any map marker to unlock</span>
            </div>
          </div>
        )}
      </div>

      {/* Selected Event Floating Overlay Card */}
      {selectedEvent && (
        <div className="glass-card">
          <button className="btn-close" onClick={() => setSelectedEvent(null)}>
            &times;
          </button>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px 0', paddingRight: '20px' }}>
            {selectedEvent.title}
          </h2>
          <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>
            {selectedEvent.category || 'Volunteer Opportunity'}
          </div>
          <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
            <strong>Org:</strong> {selectedEvent.organization || 'N/A'}
          </div>
          <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
            <strong>Address:</strong> {selectedEvent.location?.address || 'N/A'}
          </div>
          <button
            className="btn-translate"
            onClick={handleTranslate}
            disabled={isTranslating}
          >
            {isTranslating ? 'Translating...' : 'Translate with Gemini AI'}
          </button>
        </div>
      )}
    </div>
  );
}

