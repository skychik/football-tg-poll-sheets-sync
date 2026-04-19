import type { PollStorage } from './poll-storage/poll-storage-types';

/**
 * Poll data for in-memory aggregation before persisting to storage.
 */
export interface PollData {
  question: string;
  options: string[];
  votes: Map<number, Set<string>>; // optionIndex -> Set of @usernames
}

function deserializeVotes(
  serializedVotes: Record<string, string[]>,
): Map<number, Set<string>> {
  const votes = new Map<number, Set<string>>();

  for (const [optionIndex, voters] of Object.entries(serializedVotes)) {
    votes.set(Number(optionIndex), new Set(voters));
  }

  return votes;
}

/**
 * Serialize vote map for {@link PollStorage.updatePollVotes}.
 */
export function serializePollVotes(
  votes: Map<number, Set<string>>,
): Record<string, string[]> {
  const serializedVotes: Record<string, string[]> = {};

  for (const [optionIndex, voters] of votes.entries()) {
    serializedVotes[String(optionIndex)] = Array.from(voters);
  }

  return serializedVotes;
}

export async function getPollById(
  pollId: string,
  storage: PollStorage,
): Promise<PollData | null> {
  const storedPollData = await storage.getPollData(pollId);
  if (!storedPollData) {
    return null;
  }

  return {
    question: storedPollData.question,
    options: storedPollData.options,
    votes: deserializeVotes(storedPollData.votes),
  };
}
