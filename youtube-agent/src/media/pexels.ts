import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import type { BrollAsset } from '../types.js';
import { getLogger } from '../logger.js';
import { errorMessage } from '../utils/index.js';

const log = getLogger('pexels');

interface PexelsPhoto {
  photographer?: string;
  url?: string;
  src?: { large2x?: string; large?: string; original?: string };
}

/**
 * Free stock imagery for the b-roll slots the script asks for. Optional: with
 * no key the agent writes the search queries into broll.md instead so they can
 * be sourced by hand.
 */
export class PexelsClient {
  constructor(private readonly apiKey: string | undefined) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async searchPhotos(query: string, perPage: number): Promise<BrollAsset[]> {
    if (!this.apiKey || perPage < 1) return [];

    try {
      const url = new URL('https://api.pexels.com/v1/search');
      url.searchParams.set('query', query);
      url.searchParams.set('per_page', String(Math.min(perPage, 20)));
      url.searchParams.set('orientation', 'landscape');

      const response = await fetch(url, {
        headers: { Authorization: this.apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`Pexels API ${response.status}`);

      const photos = ((await response.json()) as { photos?: PexelsPhoto[] }).photos ?? [];
      return photos
        .map((photo): BrollAsset | null => {
          const src = photo.src?.large2x ?? photo.src?.large ?? photo.src?.original;
          if (!src) return null;
          return {
            sceneId: '',
            query,
            kind: 'photo',
            url: src,
            // Pexels' licence does not require attribution, but crediting the
            // photographer is the decent thing to do and costs nothing.
            credit: `Photo by ${photo.photographer ?? 'unknown'} on Pexels — ${photo.url ?? 'https://pexels.com'}`,
          };
        })
        .filter((a): a is BrollAsset => a !== null);
    } catch (error) {
      log.warn({ query, err: errorMessage(error) }, 'pexels search failed');
      return [];
    }
  }
}

/** Downloads an asset into the project folder. Returns the relative path. */
export async function downloadAsset(asset: BrollAsset, destDir: string, basename: string): Promise<string | null> {
  try {
    await mkdir(destDir, { recursive: true });
    const response = await fetch(asset.url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new Error(`download ${response.status}`);

    const ext = asset.kind === 'video' ? '.mp4' : extensionFor(asset.url);
    const file = path.join(destDir, `${basename}${ext}`);
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(file));
    return file;
  } catch (error) {
    log.warn({ url: asset.url, err: errorMessage(error) }, 'asset download failed');
    return null;
  }
}

function extensionFor(url: string): string {
  const match = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(url);
  return match?.[1] ? `.${match[1].toLowerCase()}` : '.jpg';
}
