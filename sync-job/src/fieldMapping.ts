import { extractTagValue, formatDate, formatTime, parseAreaLalo } from './xml.ts';

export const CATEGORY_NAMES: Record<string, string> = {
  '생활편의': 'Living Support',
  '주거환경': 'Housing & Environment',
  '상담ㆍ멘토링': 'Counseling & Mentoring',
  '교육': 'Education',
  '보건ㆍ의료': 'Health & Medical',
  '농어촌 봉사': 'Rural Community',
  '문화ㆍ체육ㆍ예술ㆍ관광': 'Culture, Sports & Tourism',
  '환경ㆍ생태계보호': 'Environment',
  '사무행정': 'Administration',
  '지역안전ㆍ보호': 'Community Safety',
  '인권ㆍ공익': 'Human Rights & Public Interest',
  '재난ㆍ재해': 'Disaster Relief',
  '국제협력ㆍ해외봉사': 'International Cooperation',
  '기타': 'Other',
  '자원봉사 기본교육': 'Volunteer Basic Training',
  '온라인자원봉사': 'Online Volunteering',
};

export interface VolunteerDoc {
  id: string;
  title: string;
  organization?: string;
  category: string;
  status: string;
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
  lat?: number;
  lng?: number;
  address?: string;
  adultPosblAt?: string;
  yngbgsPosblAt?: string;
  familyPosblAt?: string;
  grpPosblAt?: string;
  pbsvntPosblAt?: string;
  actWkdy?: string;
  email?: string;
  telno?: string;
  expiresOn?: string;
  lastDetailFetchAt?: number;
  sourcePage?: number;
}

function toIsoDate(raw: string): string | undefined {
  if (raw.length !== 8) return undefined;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export function mapListItem(itemXml: string, pageNo: number, today: Date): Partial<VolunteerDoc> | null {
  const id = extractTagValue(itemXml, 'progrmRegistNo');
  const title = extractTagValue(itemXml, 'progrmSj');
  if (!id || !title) return null;

  const startDateRaw = extractTagValue(itemXml, 'progrmBgnde');
  const endDateRaw = extractTagValue(itemXml, 'progrmEndde');
  const referenceDateRaw = endDateRaw || startDateRaw;

  if (referenceDateRaw && referenceDateRaw.length === 8) {
    const y = parseInt(referenceDateRaw.slice(0, 4), 10);
    const m = parseInt(referenceDateRaw.slice(4, 6), 10);
    const d = parseInt(referenceDateRaw.slice(6, 8), 10);
    const refDate = new Date(y, m - 1, d);
    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);
    if (!isNaN(refDate.getTime()) && refDate < todayStart) return null;
  }

  const categoryCode = extractTagValue(itemXml, 'srvcClCode');

  return {
    id,
    title,
    organization: extractTagValue(itemXml, 'nanmmbyNm') || undefined,
    category: CATEGORY_NAMES[categoryCode] || categoryCode || 'Volunteer',
    status: 'Recruiting',
    startDate: formatDate(startDateRaw),
    endDate: formatDate(endDateRaw),
    startTime: formatTime(extractTagValue(itemXml, 'actBeginTm')),
    endTime: formatTime(extractTagValue(itemXml, 'actEndTm')),
    recruitStartDate: formatDate(extractTagValue(itemXml, 'noticeBgnde')),
    recruitEndDate: formatDate(extractTagValue(itemXml, 'noticeEndde')),
    externalUrl: extractTagValue(itemXml, 'url') || undefined,
    address: extractTagValue(itemXml, 'actPlace') || undefined,
    adultPosblAt: extractTagValue(itemXml, 'adultPosblAt') || undefined,
    yngbgsPosblAt: extractTagValue(itemXml, 'yngbgsPosblAt') || undefined,
    expiresOn: toIsoDate(referenceDateRaw),
    sourcePage: pageNo,
  };
}

// Detail-endpoint fields only. `nanmmbyNm` is deliberately NOT read here —
// on this endpoint it names the overseeing district office, not the host
// org, and would silently corrupt `organization` if merged in.
export function mergeDetailFields(doc: Partial<VolunteerDoc>, detailItemXml: string): Partial<VolunteerDoc> {
  const coords =
    parseAreaLalo(extractTagValue(detailItemXml, 'areaLalo1')) ||
    parseAreaLalo(extractTagValue(detailItemXml, 'areaLalo2')) ||
    parseAreaLalo(extractTagValue(detailItemXml, 'areaLalo3'));

  const rcritNmpr = parseInt(extractTagValue(detailItemXml, 'rcritNmpr'), 10);
  const appTotal = parseInt(extractTagValue(detailItemXml, 'appTotal'), 10);

  return {
    ...doc,
    lat: coords?.lat,
    lng: coords?.lng,
    description: extractTagValue(detailItemXml, 'progrmCn') || undefined,
    spotsNeeded: isNaN(rcritNmpr) ? undefined : rcritNmpr,
    spotsFilled: isNaN(appTotal) ? undefined : appTotal,
    familyPosblAt: extractTagValue(detailItemXml, 'familyPosblAt') || undefined,
    grpPosblAt: extractTagValue(detailItemXml, 'grpPosblAt') || undefined,
    pbsvntPosblAt: extractTagValue(detailItemXml, 'pbsvntPosblAt') || undefined,
    actWkdy: extractTagValue(detailItemXml, 'actWkdy') || undefined,
    email: extractTagValue(detailItemXml, 'email') || undefined,
    telno: extractTagValue(detailItemXml, 'telno') || undefined,
  };
}
