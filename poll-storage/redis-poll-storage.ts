import Redis from 'ioredis';
import type { PollStorage, StoredPollData } from './poll-storage-types';

function getPollKey(pollId: string): string {
  return `poll:${pollId}`;
}

/**
 * Poll persistence backed by Redis. Lazily reads `REDIS_URL` when the client is first used.
 */
export class IoredisPollStorage implements PollStorage {
  private client: Redis | null = null;

  private getClient(): Redis {
    if (!this.client) {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) {
        throw new Error('REDIS_URL environment variable is required');
      }
      this.client = new Redis(redisUrl, {
        lazyConnect: true,
      });
    }
    return this.client;
  }

  async ensureReady(): Promise<void> {
    try {
      await this.getClient().ping();
    } catch (error) {
      throw new Error(
        `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async savePollData(pollId: string, pollData: StoredPollData): Promise<void> {
    await this.getClient().set(getPollKey(pollId), JSON.stringify(pollData));
  }

  async getPollData(pollId: string): Promise<StoredPollData | null> {
    const rawData = await this.getClient().get(getPollKey(pollId));
    if (!rawData) {
      return null;
    }

    return JSON.parse(rawData) as StoredPollData;
  }

  async updatePollVotes(
    pollId: string,
    votes: Record<string, string[]>,
  ): Promise<void> {
    const pollData = await this.getPollData(pollId);
    if (!pollData) {
      return;
    }

    pollData.votes = votes;
    await this.savePollData(pollId, pollData);
  }
}
