import { extractItems, extractTagValue } from './xml.ts';

export class CallBudgetExceededError extends Error {
  constructor() {
    super('data.go.kr call budget exceeded for this run');
    this.name = 'CallBudgetExceededError';
  }
}

const BASE_URL = 'https://apis.data.go.kr/1741000/volunteerPartcptnService';

export class DataGoKrClient {
  private serviceKey: string;
  private budget: number;
  private fetchImpl: typeof fetch;
  private calls: number;

  constructor(serviceKey: string, budget: number, fetchImpl: typeof fetch = fetch) {
    this.serviceKey = serviceKey;
    this.budget = budget;
    this.fetchImpl = fetchImpl;
    this.calls = 0;
  }

  get callsMade(): number {
    return this.calls;
  }

  get remainingBudget(): number {
    return this.budget - this.calls;
  }

  private async request(url: string): Promise<string> {
    if (this.calls >= this.budget) {
      throw new CallBudgetExceededError();
    }
    this.calls += 1;
    const response = await this.fetchImpl(url);
    if (!response.ok) {
      throw new Error(`data.go.kr HTTP error: ${response.status} ${response.statusText}`);
    }
    const xmlText = await response.text();
    const resultCode = extractTagValue(xmlText, 'resultCode');
    if (resultCode && resultCode !== '00' && resultCode !== '0000') {
      throw new Error(`data.go.kr returned error code ${resultCode}: ${extractTagValue(xmlText, 'resultMsg')}`);
    }
    return xmlText;
  }

  private encodedKey(): string {
    return this.serviceKey.includes('%') ? this.serviceKey : encodeURIComponent(this.serviceKey);
  }

  async fetchListPage(pageNo: number): Promise<{ items: string[]; totalCount: number }> {
    const url = `${BASE_URL}/getVltrSearchWordList?serviceKey=${this.encodedKey()}&numOfRows=100&pageNo=${pageNo}`;
    const xmlText = await this.request(url);
    const totalCount = parseInt(extractTagValue(xmlText, 'totalCount'), 10);
    return { items: extractItems(xmlText), totalCount: isNaN(totalCount) ? 0 : totalCount };
  }

  async fetchDetail(id: string): Promise<string> {
    const url = `${BASE_URL}/getVltrPartcptnItem?serviceKey=${this.encodedKey()}&progrmRegistNo=${encodeURIComponent(id)}`;
    const xmlText = await this.request(url);
    const items = extractItems(xmlText);
    return items[0] ?? xmlText;
  }
}
