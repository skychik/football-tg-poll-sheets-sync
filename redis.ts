import Redis from 'ioredis';

export interface StoredPollData {
  question: string;
  options: string[];
  votes: Record<string, string[]>;
}

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL environment variable is required');
}

export const redis = new Redis(redisUrl, {
  lazyConnect: true,
});

function getPollKey(pollId: string): string {
  return `poll:${pollId}`;
}

export async function ensureRedisReady(): Promise<void> {
  try {
    await redis.ping();
  } catch (error) {
    throw new Error(
      `Failed to connect to Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export async function savePollData(
  pollId: string,
  pollData: StoredPollData,
): Promise<void> {
  await redis.set(getPollKey(pollId), JSON.stringify(pollData));
}

export async function getPollData(
  pollId: string,
): Promise<StoredPollData | null> {
  const rawData = await redis.get(getPollKey(pollId));
  if (!rawData) {
    return null;
  }

  return JSON.parse(rawData) as StoredPollData;
}

export async function updatePollVotes(
  pollId: string,
  votes: Record<string, string[]>,
): Promise<void> {
  const pollData = await getPollData(pollId);
  if (!pollData) {
    return;
  }

  pollData.votes = votes;
  await savePollData(pollId, pollData);
}
