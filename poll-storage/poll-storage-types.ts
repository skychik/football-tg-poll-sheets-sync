export interface StoredPollData {
  question: string;
  options: string[];
  votes: Record<string, string[]>;
}

export interface PollStorage {
  ensureReady(): Promise<void>;
  savePollData(pollId: string, pollData: StoredPollData): Promise<void>;
  getPollData(pollId: string): Promise<StoredPollData | null>;
  updatePollVotes(
    pollId: string,
    votes: Record<string, string[]>,
  ): Promise<void>;
}
