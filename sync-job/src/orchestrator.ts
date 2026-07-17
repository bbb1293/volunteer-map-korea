import { CallBudgetExceededError, DataGoKrClient } from './dataGoKrClient.ts';
import type { FirestoreRepo } from './firestoreRepo.ts';
import { mapListItem, mergeDetailFields, type VolunteerDoc } from './fieldMapping.ts';
import { pickDetailFetchTargets, type StaleDocRef } from './prioritization.ts';
import { geocodeAddress } from './geocode.ts';

export interface OrchestratorOptions {
  client: DataGoKrClient;
  repo: FirestoreRepo;
  googleMapsApiKey?: string;
  today?: Date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function runSync(
  options: OrchestratorOptions
): Promise<{ pruned: number; sweptPages: number; detailFetched: number }> {
  const { client, repo, googleMapsApiKey } = options;
  const today = options.today ?? new Date();

  const pruned = await repo.deleteExpired(toIsoDate(today));

  const existingIds = await repo.getAllIds();
  const newIds: string[] = [];
  const listDocs = new Map<string, Partial<VolunteerDoc>>();
  let sweptPages = 0;
  let totalPages = 1;
  let page = 1;

  try {
    while (page <= totalPages) {
      const { items, totalCount } = await client.fetchListPage(page);
      totalPages = Math.max(1, Math.ceil(totalCount / 100));
      for (const itemXml of items) {
        const doc = mapListItem(itemXml, page, today);
        if (!doc?.id) continue;
        listDocs.set(doc.id, doc);
        await repo.upsertDoc(doc as Partial<VolunteerDoc> & { id: string });
        if (!existingIds.has(doc.id)) newIds.push(doc.id);
      }
      sweptPages += 1;
      page += 1;
    }
  } catch (error) {
    if (!(error instanceof CallBudgetExceededError)) throw error;
  }

  const remainingBudget = client.remainingBudget;
  let detailFetched = 0;

  if (remainingBudget > 0) {
    const staleDocs: StaleDocRef[] = await repo.getStaleDocs(remainingBudget);
    const targets = pickDetailFetchTargets(newIds, staleDocs, remainingBudget);

    for (const id of targets) {
      try {
        const detailXml = await client.fetchDetail(id);
        let merged = mergeDetailFields(listDocs.get(id) ?? { id }, detailXml);

        if ((merged.lat === undefined || merged.lng === undefined) && merged.address && googleMapsApiKey) {
          const coords = await geocodeAddress(merged.address, googleMapsApiKey);
          if (coords) {
            merged = { ...merged, lat: coords.lat, lng: coords.lng };
          }
        }

        await repo.upsertDoc({ ...merged, id, lastDetailFetchAt: Date.now() });
        detailFetched += 1;
      } catch (error) {
        if (error instanceof CallBudgetExceededError) break;
        console.warn(`Failed to detail-fetch ${id}:`, error);
      }
    }
  }

  return { pruned, sweptPages, detailFetched };
}
