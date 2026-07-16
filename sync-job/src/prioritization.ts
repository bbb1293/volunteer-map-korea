export interface StaleDocRef {
  id: string;
  lastDetailFetchAt: number;
}

export function pickDetailFetchTargets(newIds: string[], staleDocs: StaleDocRef[], budget: number): string[] {
  const orderedStale = [...staleDocs].sort((a, b) => a.lastDetailFetchAt - b.lastDetailFetchAt).map((d) => d.id);
  return [...newIds, ...orderedStale].slice(0, Math.max(0, budget));
}
