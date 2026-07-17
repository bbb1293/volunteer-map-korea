import { Firestore } from '@google-cloud/firestore';
import { DataGoKrClient } from './dataGoKrClient.ts';
import { FirestoreRepoImpl } from './firestoreRepo.ts';
import { runSync } from './orchestrator.ts';

async function main(): Promise<void> {
  const serviceKey = process.env.DATA_GO_KR_API_KEY;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!serviceKey) {
    throw new Error('DATA_GO_KR_API_KEY is required');
  }

  const db = new Firestore();
  const repo = new FirestoreRepoImpl(db);
  const client = new DataGoKrClient(serviceKey, 950);

  const result = await runSync({ client, repo, googleMapsApiKey });
  console.log(
    `Sync complete: pruned=${result.pruned} sweptPages=${result.sweptPages} detailFetched=${result.detailFetched} callsMade=${client.callsMade}`
  );
}

main().catch((error) => {
  console.error('Sync job failed:', error);
  process.exit(1);
});
