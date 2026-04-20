import type { PollStorage, StoredPollData } from './poll-storage-types';

/**
 * In-memory poll persistence for tests.
 */
export class InMemoryPollStorage implements PollStorage {
  private readonly store = new Map<string, string>();

  async ensureReady(): Promise<void> {}

  async savePollData(pollId: string, pollData: StoredPollData): Promise<void> {
    this.store.set(pollId, JSON.stringify(pollData));
  }

  async getPollData(pollId: string): Promise<StoredPollData | null> {
    const raw = this.store.get(pollId);
    return raw ? (JSON.parse(raw) as StoredPollData) : null;
  }

  async updatePollVotes(
    pollId: string,
    votes: Record<string, string[]>,
  ): Promise<void> {
    const raw = this.store.get(pollId);
    if (!raw) return;
    const p = JSON.parse(raw) as StoredPollData;
    p.votes = votes;
    this.store.set(pollId, JSON.stringify(p));
  }

  clear(): void {
    this.store.clear();
  }
}
