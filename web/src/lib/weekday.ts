const DAY_LABELS: Record<'en' | 'ko', string[]> = {
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  ko: ['월', '화', '수', '목', '금', '토', '일'],
};

function collapseRanges(indices: number[], labels: string[]): string[] {
  const groups: string[] = [];
  let start = indices[0];
  let prev = indices[0];

  for (let i = 1; i <= indices.length; i++) {
    const current = indices[i];
    if (current !== prev + 1) {
      groups.push(start === prev ? labels[start] : `${labels[start]}-${labels[prev]}`);
      start = current;
    }
    prev = current;
  }
  return groups;
}

export function decodeWeekdays(bitmap: string | undefined, language: 'en' | 'ko'): string | undefined {
  if (!bitmap || bitmap.length !== 7 || !/^[01]{7}$/.test(bitmap)) return undefined;

  const labels = DAY_LABELS[language];
  const activeIndices = bitmap.split('').map((c, i) => (c === '1' ? i : -1)).filter((i) => i !== -1);

  if (activeIndices.length === 0) return undefined;
  if (activeIndices.length === 7) return language === 'en' ? 'Every day' : '매일';

  return collapseRanges(activeIndices, labels).join(', ');
}
