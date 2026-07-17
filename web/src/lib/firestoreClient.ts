import { Firestore } from '@google-cloud/firestore';

let instance: Firestore | null = null;

export function getFirestoreClient(): Firestore {
  if (!instance) {
    instance = new Firestore();
  }
  return instance;
}
