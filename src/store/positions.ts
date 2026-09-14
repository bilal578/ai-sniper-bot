import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getLogger } from '../logger.js';
import { errorMessage } from '../utils/index.js';
import type { Position } from '../types.js';

const log = getLogger('store');

/**
 * Crash-safe JSON store. Positions represent real money, so every write goes
 * to a temp file and is atomically renamed — a kill mid-write can never leave
 * a truncated ledger behind.
 */
export class PositionStore {
  private positions = new Map<string, Position>();
  private readonly file: string;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = join(dataDir, 'positions.json');
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Position[];
      this.positions = new Map(parsed.map((p) => [p.id, p]));
      log.info({ count: this.positions.size, file: this.file }, 'position store loaded');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        log.info({ file: this.file }, 'no existing position store; starting fresh');
        return;
      }
      // A corrupt ledger must not be silently overwritten — it may be
      // recoverable by hand, and it records real holdings.
      throw new Error(`Failed to read position store at ${this.file}: ${errorMessage(error)}`);
    }
  }

  private async persist(): Promise<void> {
    // Serialise writes so two concurrent exits cannot interleave renames.
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify([...this.positions.values()], null, 2), 'utf8');
      await rename(tmp, this.file);
    });
    return this.writeChain;
  }

  async upsert(position: Position): Promise<void> {
    this.positions.set(position.id, position);
    await this.persist();
  }

  get(id: string): Position | undefined {
    return this.positions.get(id);
  }

  getByMint(mint: string): Position | undefined {
    return [...this.positions.values()].find((p) => p.mint === mint && p.status === 'open');
  }

  all(): Position[] {
    return [...this.positions.values()];
  }

  open(): Position[] {
    return this.all().filter((p) => p.status === 'open' || p.status === 'closing');
  }

  closed(): Position[] {
    return this.all().filter((p) => p.status === 'closed');
  }
}
