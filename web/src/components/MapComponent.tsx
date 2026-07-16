'use client';
import { useEffect, useRef, useState } from 'react';

interface VolunteerEvent {
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
  externalUrl?: string;
  description?: string;
  spotsNeeded?: number;
  spotsFilled?: number;
  location?: {
    lat: number;
    lng: number;
    address?: string;
  };
}

// Category -> group mapping. Each of the ~16 API categories folds into one of
// 5 groups so the map uses a validated 4-hue categorical palette (+ neutral
// "Other") rather than 16 indistinguishable colors.
type CategoryGroup = 'education' | 'environment' | 'health' | 'safety' | 'other';

const CATEGORY_GROUPS: Record<string, CategoryGroup> = {
  'Education': 'education',
  'Counseling & Mentoring': 'education',
  'Volunteer Basic Training': 'education',
  'Environment': 'environment',
  'Housing & Environment': 'environment',
  'Rural Community': 'environment',
  'Health & Medical': 'health',
  'Living Support': 'health',
  'Community Safety': 'safety',
  'Human Rights & Public Interest': 'safety',
  'Disaster Relief': 'safety',
  'Administration': 'safety',
};

function getCategoryGroup(category?: string): CategoryGroup {
  return (category && CATEGORY_GROUPS[category]) || 'other';
}

// Only treat an event as "full" when we have real headcount data for it —
// most listings currently lack spotsNeeded/spotsFilled (detail fetch can
// time out under load), and those should stay visible rather than be
// silently hidden by a filter that can't actually evaluate them.
function isFull(event: VolunteerEvent): boolean {
  return (
    typeof event.spotsNeeded === 'number' &&
    typeof event.spotsFilled === 'number' &&
    event.spotsFilled >= event.spotsNeeded
  );
}

// Validated categorical palette (dataviz skill): the first 4 slots (blue,
// green, magenta, yellow) pass all-pairs CVD/contrast checks; "other" uses a
// neutral gray rather than a 5th competing hue. Labels are static/bilingual
// since these 5 buckets are our own invented taxonomy, not source data.
const GROUP_STYLES: Record<CategoryGroup, { color: string; label: { en: string; ko: string }; icon: string }> = {
  education: {
    color: '#2a78d6',
    label: { en: 'Education & Mentoring', ko: '교육 및 멘토링' },
    icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>',
  },
  environment: {
    color: '#008300',
    label: { en: 'Environment & Nature', ko: '환경 및 자연' },
    icon: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 3.5 1 8a8.5 8.5 0 0 1-9 10Z"></path><path d="M19 2c-2.26 4.33-5.27 7.14-8 10"></path>',
  },
  health: {
    color: '#e87ba4',
    label: { en: 'Health & Care', ko: '보건 및 돌봄' },
    icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
  },
  safety: {
    color: '#eda100',
    label: { en: 'Safety & Public Service', ko: '안전 및 공공서비스' },
    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>',
  },
  other: {
    color: '#898781',
    label: { en: 'Other', ko: '기타' },
    icon: '<path d="M20.59 13.41 11 3.83A2 2 0 0 0 9.83 3H4a1 1 0 0 0-1 1v5.83a2 2 0 0 0 .59 1.41l9.58 9.58a2 2 0 0 0 2.83 0l4.59-4.59a2 2 0 0 0 0-2.83z"></path><circle cx="7.5" cy="7.5" r="1.5" fill="white" stroke="none"></circle>',
  },
};

// Static UI chrome strings — these are our own fixed labels, not source data,
// so a translation dictionary is the right tool rather than a Gemini call.
const UI_TEXT = {
  en: {
    badgesTitle: 'Volunteer Impact Badges',
    badgeName: 'Seoul Explorer',
    badgeDescUnlocked: 'Discovered your first volunteer opportunity!',
    badgeDescLocked: 'Click any map marker to unlock',
    org: 'Org:',
    address: 'Address:',
    notAvailable: 'N/A',
    volunteerOpportunity: 'Volunteer Opportunity',
    kmAway: 'km away',
    share: 'Share',
    linkCopied: 'Link Copied!',
    recenterTitle: 'Recenter Map to My Location',
    when: 'When:',
    dailyTime: 'Daily time:',
    viewOriginal: 'View Original Listing ↗',
    description: 'Description:',
    spotsFilled: 'Spots filled:',
    hideFullFilter: 'Hide full opportunities',
  },
  ko: {
    badgesTitle: '봉사활동 임팩트 배지',
    badgeName: '서울 탐험가',
    badgeDescUnlocked: '첫 자원봉사 기회를 발견했습니다!',
    badgeDescLocked: '지도 마커를 클릭하여 잠금 해제',
    org: '기관:',
    address: '주소:',
    notAvailable: '정보 없음',
    volunteerOpportunity: '자원봉사 기회',
    kmAway: 'km 거리',
    share: '공유',
    linkCopied: '링크 복사됨!',
    recenterTitle: '내 위치로 이동',
    when: '기간:',
    dailyTime: '활동 시간:',
    viewOriginal: '1365 포털에서 원본 보기 ↗',
    description: '설명:',
    spotsFilled: '모집 현황:',
    hideFullFilter: '마감된 활동 숨기기',
  },
};

export default function MapComponent() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const mapInitialized = useRef(false);

  const [selectedEvent, setSelectedEvent] = useState<VolunteerEvent | null>(null);
  const [language, setLanguage] = useState<'ko' | 'en'>('ko');
  const [translationCache, setTranslationCache] = useState<Record<string, { title: string; organization?: string; address?: string; description?: string }>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [clickedCount, setClickedCount] = useState(0);
  const [isLocating, setIsLocating] = useState(false);
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [hideFullEvents, setHideFullEvents] = useState(false);
  const hideFullRef = useRef(false);
  const markersRef = useRef<{ marker: google.maps.marker.AdvancedMarkerElement; event: VolunteerEvent }[]>([]);
  const userMarkerRef = useRef<google.maps.marker.AdvancedMarkerElement | null>(null);
  const hasCenteredOnUser = useRef(false);

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
                  const groupStyle = GROUP_STYLES[getCategoryGroup(event.category)];
                  const pinColor = groupStyle.color;
                  pinContainer.style.setProperty('--pin-color', pinColor);

                  const svgIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;">${groupStyle.icon}</svg>`;

                  pinContainer.innerHTML = `
                    <div class="pin-pulse" style="background-color: ${pinColor}"></div>
                    <div class="pin-core" style="background-color: ${pinColor}">
                      ${svgIcon}
                    </div>
                  `;

                  const marker = new google.maps.marker.AdvancedMarkerElement({
                    map: (hideFullRef.current && isFull(event)) ? null : newMap,
                    position: { lat: event.location.lat, lng: event.location.lng },
                    title: event.translatedTitle || event.title,
                    content: pinContainer,
                  });

                  markersRef.current.push({ marker, event });

                  marker.addListener('click', () => {
                    setSelectedEvent(event);
                    setShareStatus('idle');
                    setClickedCount((prev) => prev + 1);
                  });
                }
              });

              // If this page was opened via a shared link (?event=<id>), open
              // that event's card and center the map on it instead of the
              // default/geolocation center.
              const sharedId = new URLSearchParams(window.location.search).get('event');
              if (sharedId) {
                const sharedEvent = data.events.find((e: VolunteerEvent) => e.id === sharedId);
                if (sharedEvent?.location) {
                  setSelectedEvent(sharedEvent);
                  newMap.setCenter({ lat: sharedEvent.location.lat, lng: sharedEvent.location.lng });
                  newMap.setZoom(16);
                  hasCenteredOnUser.current = true; // don't let geolocation override the shared spot
                }
              }
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
      markersRef.current.forEach(({ marker }) => {
        marker.map = null;
      });
      markersRef.current = [];
    };
  }, []);

  // Live-track the user's position with a Google-style pulsing blue dot,
  // and center the map on the first fix.
  useEffect(() => {
    if (!map || !navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
        setUserPos(pos);

        if (userMarkerRef.current) {
          userMarkerRef.current.position = pos;
        } else {
          const pinContainer = document.createElement('div');
          pinContainer.className = 'user-position-pin';
          pinContainer.innerHTML = `
            <div class="user-position-pulse"></div>
            <div class="user-position-core"></div>
          `;
          userMarkerRef.current = new google.maps.marker.AdvancedMarkerElement({
            map,
            position: pos,
            title: 'Your location',
            content: pinContainer,
            zIndex: 500,
          });
        }

        if (!hasCenteredOnUser.current) {
          map.setCenter(pos);
          map.setZoom(14);
          hasCenteredOnUser.current = true;
        }
      },
      (error) => {
        console.log('Geolocation watch denied/failed:', error.message);
      },
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
      if (userMarkerRef.current) {
        userMarkerRef.current.map = null;
        userMarkerRef.current = null;
      }
      hasCenteredOnUser.current = false;
    };
  }, [map]);

  // Show/hide markers for events we know are full, without recreating them.
  useEffect(() => {
    hideFullRef.current = hideFullEvents;
    if (!map) return;
    markersRef.current.forEach(({ marker, event }) => {
      marker.map = hideFullEvents && isFull(event) ? null : map;
    });
  }, [hideFullEvents, map]);

  // Load the saved language preference once on mount.
  useEffect(() => {
    const saved = window.localStorage.getItem('vmk-language');
    if (saved === 'ko' || saved === 'en') setLanguage(saved);
  }, []);

  const handleSetLanguage = (lang: 'ko' | 'en') => {
    setLanguage(lang);
    window.localStorage.setItem('vmk-language', lang);
  };

  // Korean is the default (matches the source data). English comes either
  // from a static pre-set translation (mock data's translatedTitle) or,
  // failing that, an on-demand Gemini call — cached per event so switching
  // back and forth doesn't re-translate.
  const translatingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedEvent || language !== 'en') return;
    if (selectedEvent.translatedTitle) return;
    if (translationCache[selectedEvent.id]) return;
    if (translatingRef.current === selectedEvent.id) return;

    let cancelled = false;
    translatingRef.current = selectedEvent.id;
    setTranslatingId(selectedEvent.id);

    fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: selectedEvent.id,
        title: selectedEvent.title,
        organization: selectedEvent.organization,
        address: selectedEvent.location?.address,
        description: selectedEvent.description,
        lang: 'English',
      }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Translation failed'))))
      .then((data) => {
        if (cancelled) return;
        setTranslationCache((prev) => ({
          ...prev,
          [selectedEvent.id]: {
            title: data.title,
            organization: data.organization,
            address: data.address,
            description: data.description,
          },
        }));
      })
      .catch((err) => console.error('Auto-translate failed:', err))
      .finally(() => {
        if (cancelled) return;
        translatingRef.current = null;
        setTranslatingId((current) => (current === selectedEvent.id ? null : current));
      });

    return () => {
      cancelled = true;
    };
  }, [selectedEvent, language, translationCache]);

  // Resolves what to actually display for the current language setting.
  const getDisplayText = (event: VolunteerEvent) => {
    const address = event.location?.address;
    const description = event.description;
    if (language === 'ko') {
      return { title: event.title, organization: event.organization, address, description, isTranslating: false };
    }
    if (event.translatedTitle) {
      // Mock data's address is already static English; no translation needed.
      return { title: event.translatedTitle, organization: event.organization, address, description, isTranslating: false };
    }
    const cached = translationCache[event.id];
    if (cached) {
      return {
        title: cached.title,
        organization: cached.organization,
        address: cached.address || address,
        description: cached.description || description,
        isTranslating: false,
      };
    }
    return { title: event.title, organization: event.organization, address, description, isTranslating: translatingId === event.id };
  };

  const handleLocate = () => {
    if (!map) return;
    if (userPos) {
      map.panTo(userPos);
      map.setZoom(14);
      return;
    }
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
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
  };

  const handleShare = async () => {
    if (!selectedEvent) return;
    const url = `${window.location.origin}${window.location.pathname}?event=${encodeURIComponent(selectedEvent.id)}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: selectedEvent.translatedTitle || selectedEvent.title,
          text: 'Check out this volunteer opportunity on Volunteer Map Korea!',
          url,
        });
        return;
      } catch {
        // User cancelled the native share sheet or it failed; fall back to clipboard.
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 2000);
    } catch {
      alert(`Could not copy automatically. Here's the link:\n${url}`);
    }
  };

  // Haversine distance in km between the user and a volunteer event.
  const getDistanceKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const lat1 = (a.lat * Math.PI) / 180;
    const lat2 = (b.lat * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* GPS Target Button Overlay */}
      <button
        className="gps-button"
        onClick={handleLocate}
        disabled={isLocating}
        title={UI_TEXT[language].recenterTitle}
        aria-label={UI_TEXT[language].recenterTitle}
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

      {/* Language Setting */}
      <div className="lang-toggle">
        <button
          className={`lang-btn ${language === 'ko' ? 'active' : ''}`}
          onClick={() => handleSetLanguage('ko')}
        >
          한국어
        </button>
        <button
          className={`lang-btn ${language === 'en' ? 'active' : ''}`}
          onClick={() => handleSetLanguage('en')}
        >
          English
        </button>
      </div>

      {/* Category Color Legend */}
      <div className="category-legend">
        {(Object.keys(GROUP_STYLES) as CategoryGroup[]).map((group) => (
          <div key={group} className="legend-row">
            <span className="legend-dot" style={{ backgroundColor: GROUP_STYLES[group].color }} />
            <span className="legend-label">{GROUP_STYLES[group].label[language]}</span>
          </div>
        ))}
        <label className="legend-filter-row">
          <input
            type="checkbox"
            checked={hideFullEvents}
            onChange={(e) => setHideFullEvents(e.target.checked)}
          />
          <span className="legend-label">{UI_TEXT[language].hideFullFilter}</span>
        </label>
      </div>

      {/* Gamification Badges Overlay */}
      <div className="badge-overlay">
        <h3 className="badge-overlay-title">{UI_TEXT[language].badgesTitle}</h3>
        {clickedCount >= 1 ? (
          <div className="badge-item unlocked">
            <div className="badge-icon">🌟</div>
            <div className="badge-info">
              <span className="badge-name">{UI_TEXT[language].badgeName}</span>
              <span className="badge-desc">{UI_TEXT[language].badgeDescUnlocked}</span>
            </div>
          </div>
        ) : (
          <div className="badge-item locked">
            <div className="badge-icon">🔒</div>
            <div className="badge-info">
              <span className="badge-name">{UI_TEXT[language].badgeName}</span>
              <span className="badge-desc">{UI_TEXT[language].badgeDescLocked}</span>
            </div>
          </div>
        )}
      </div>

      {/* Selected Event Floating Overlay Card */}
      {selectedEvent && (() => {
        const display = getDisplayText(selectedEvent);
        return (
          <div className="glass-card">
            <button className="btn-close" onClick={() => setSelectedEvent(null)}>
              &times;
            </button>
            <h2 style={{ fontSize: '18px', margin: '0 0 8px 0', paddingRight: '20px' }}>
              {display.title}
              {display.isTranslating && <span className="translating-hint"> (translating…)</span>}
            </h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#334155', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>
              <span
                className="legend-dot"
                style={{ backgroundColor: GROUP_STYLES[getCategoryGroup(selectedEvent.category)].color }}
              />
              {selectedEvent.category ? GROUP_STYLES[getCategoryGroup(selectedEvent.category)].label[language] : UI_TEXT[language].volunteerOpportunity}
              {userPos && selectedEvent.location && (
                <span style={{ color: '#64748b', fontWeight: 500, textTransform: 'none' }}>
                  {' '}· {getDistanceKm(userPos, selectedEvent.location).toFixed(1)} {UI_TEXT[language].kmAway}
                </span>
              )}
            </div>
            <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
              <strong>{UI_TEXT[language].org}</strong> {display.organization || UI_TEXT[language].notAvailable}
            </div>
            <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
              <strong>{UI_TEXT[language].address}</strong> {display.address || UI_TEXT[language].notAvailable}
            </div>
            {(selectedEvent.startDate || selectedEvent.endDate) && (
              <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
                <strong>{UI_TEXT[language].when}</strong> {selectedEvent.startDate || '?'} ~ {selectedEvent.endDate || '?'}
              </div>
            )}
            {(selectedEvent.startTime || selectedEvent.endTime) && (
              <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
                <strong>{UI_TEXT[language].dailyTime}</strong> {selectedEvent.startTime || '?'} - {selectedEvent.endTime || '?'}
              </div>
            )}
            {typeof selectedEvent.spotsNeeded === 'number' && (
              <div style={{ fontSize: '14px', margin: '4px 0', color: '#475569' }}>
                <strong>{UI_TEXT[language].spotsFilled}</strong> {selectedEvent.spotsFilled ?? 0} / {selectedEvent.spotsNeeded}
              </div>
            )}
            {display.description && (
              <div style={{ fontSize: '14px', margin: '8px 0 4px 0', color: '#475569' }}>
                <strong>{UI_TEXT[language].description}</strong>
                <p className="card-description">{display.description}</p>
              </div>
            )}
            <div className="card-actions">
              <button className="btn-share" onClick={handleShare}>
                {shareStatus === 'copied' ? UI_TEXT[language].linkCopied : UI_TEXT[language].share}
              </button>
            </div>
            {selectedEvent.externalUrl && (
              <a
                className="card-external-link"
                href={selectedEvent.externalUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {UI_TEXT[language].viewOriginal}
              </a>
            )}
          </div>
        );
      })()}
    </div>
  );
}

