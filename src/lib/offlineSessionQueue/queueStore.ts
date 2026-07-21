import type { PendingSessionEntry } from "./types";

export interface OfflineSessionQueueStore {
  loadEntries(): Promise<PendingSessionEntry[]>;
  saveEntries(entries: PendingSessionEntry[]): Promise<void>;
}

export class InMemoryOfflineSessionQueueStore implements OfflineSessionQueueStore {
  private entries: PendingSessionEntry[] = [];

  async loadEntries(): Promise<PendingSessionEntry[]> {
    return [...this.entries];
  }

  async saveEntries(entries: PendingSessionEntry[]): Promise<void> {
    this.entries = [...entries];
  }
}
