import type { TokenSource } from '../types.js';

export type ActivityStage = 'detected' | 'safety' | 'ai' | 'risk' | 'bought' | 'closed' | 'error';
export type ActivityOutcome = 'passed' | 'rejected' | 'bought' | 'closed' | 'error';

/** One decision the bot made about one token, as shown in the dashboard feed. */
export interface ActivityEntry {
  at: number;
  mint: string;
  symbol?: string;
  source: TokenSource;
  stage: ActivityStage;
  outcome: ActivityOutcome;
  /** Human-readable explanation — the "why" the dashboard renders. */
  reason: string;
  safetyScore?: number;
  aiScore?: number;
}

/**
 * Bounded in-memory feed of recent decisions.
 *
 * Deliberately not persisted: it is a live view, it turns over fast on a busy
 * launch window, and writing every rejection to disk would add I/O to the hot
 * path for data nobody reads twice.
 */
export class ActivityLog {
  private entries: ActivityEntry[] = [];

  constructor(private readonly maxEntries = 200) {}

  record(entry: Omit<ActivityEntry, 'at'> & { at?: number }): ActivityEntry {
    const full: ActivityEntry = { ...entry, at: entry.at ?? Date.now() };
    this.entries.unshift(full);
    if (this.entries.length > this.maxEntries) this.entries.length = this.maxEntries;
    return full;
  }

  /** Newest first. */
  recent(limit = 50): ActivityEntry[] {
    return this.entries.slice(0, limit);
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
  }
}
