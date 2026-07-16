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
  const [isLocating, setIsLocating] = useState(false);
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([]);

  useEffect(() => {
    let active = true;
    let timerId: NodeJS.Timeout;

    // Suppress ApiProjectMapError to prevent Next.js dev overlay from blocking the UI
    // when using DEMO_MAP_ID with a real API key.
    const origError = console.error;
    console.error = (...args) => {
      const msg = typeof args[0] === 'string' ? args[0] : (args[0]?.message || '');
      if (msg.includes('ApiProjectMapError')) return;
      origError.apply(console, args);
    };

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

        // Automatically request user coordinates on initialization and center/zoom on them
        if (navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              if (!active) return;
              const pos = {
                lat: position.coords.latitude,
                lng: position.coords.longitude,
              };
              newMap.setCenter(pos);
              newMap.setZoom(14);
            },
            (error) => {
              if (!active) return;
              console.log('Geolocation on initialization denied/failed:', error.message);
              // Fallback is already Seoul, which the map is initialized with.
            },
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
          );
        }

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

                  markersRef.current.push(marker);

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
      console.error = origError; // Restore original console.error
      if (timerId) clearTimeout(timerId);
      mapInitialized.current = false; // Reset to support Strict Mode remounts
      markersRef.current.forEach((m) => {
        m.map = null;
      });
      markersRef.current = [];
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
          title: selectedEvent.title,
          organization: selectedEvent.organization,
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

  const handleLocate = () => {
    if (!map) return;
    setIsLocating(true);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          map.panTo(pos);
          map.setZoom(14);
          setIsLocating(false);
        },
        (error) => {
          console.error('Error getting location:', error);
          alert('Could not retrieve your location. Please check your browser permissions.');
          setIsLocating(false);
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
    } else {
      alert('Geolocation is not supported by your browser.');
      setIsLocating(false);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* GPS Target Button Overlay */}
      <button
        className="gps-button"
        onClick={handleLocate}
        disabled={isLocating}
        title="Recenter Map to My Location"
        aria-label="Recenter Map to My Location"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={isLocating ? 'spinning' : ''}
        >
          <line x1="2" x2="5" y1="12" y2="12" />
          <line x1="19" x2="22" y1="12" y2="12" />
          <line x1="12" x2="12" y1="2" y2="5" />
          <line x1="12" x2="12" y1="19" y2="22" />
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>

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

