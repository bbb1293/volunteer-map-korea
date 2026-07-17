import { Firestore } from '@google-cloud/firestore';
import type { VolunteerDoc } from './fieldMapping.ts';
import type { StaleDocRef } from './prioritization.ts';

const COLLECTION = 'volunteerEvents';

export interface FirestoreRepo {
  getAllIds(): Promise<Set<string>>;
  getStaleDocs(limit: number): Promise<StaleDocRef[]>;
  upsertDoc(doc: Partial<VolunteerDoc> & { id: string }): Promise<void>;
  deleteExpired(todayIso: string): Promise<number>;
}

export class FirestoreRepoImpl implements FirestoreRepo {
  private db: Firestore;

  constructor(db: Firestore) {
    this.db = db;
  }

  async getAllIds(): Promise<Set<string>> {
    const snapshot = await this.db.collection(COLLECTION).select().get();
    return new Set(snapshot.docs.map((d) => d.id));
  }

  async getStaleDocs(limit: number): Promise<StaleDocRef[]> {
    const snapshot = await this.db
      .collection(COLLECTION)
      .orderBy('lastDetailFetchAt', 'asc')
      .limit(limit)
      .get();
    return snapshot.docs.map((d) => ({ id: d.id, lastDetailFetchAt: d.get('lastDetailFetchAt') ?? 0 }));
  }

  async upsertDoc(doc: Partial<VolunteerDoc> & { id: string }): Promise<void> {
    const { id, ...fields } = doc;
    await this.db.collection(COLLECTION).doc(id).set(fields, { merge: true });
  }

  async deleteExpired(todayIso: string): Promise<number> {
    const snapshot = await this.db.collection(COLLECTION).where('expiresOn', '<', todayIso).get();
    const batch = this.db.batch();
    snapshot.docs.forEach((d) => batch.delete(d.ref));
    if (snapshot.docs.length > 0) await batch.commit();
    return snapshot.docs.length;
  }
}
