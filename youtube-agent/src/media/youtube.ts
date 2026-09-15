import type { CompetitorVideo } from '../types.js';
import { getLogger } from '../logger.js';
import { errorMessage } from '../utils/index.js';

const log = getLogger('youtube');
const API = 'https://www.googleapis.com/youtube/v3';

interface SearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; channelTitle?: string; publishedAt?: string };
}

interface VideoItem {
  id?: string;
  statistics?: { viewCount?: string };
}

/**
 * Reads the public YouTube Data API for videos already ranking in a niche.
 * Entirely optional — without a key the agent still works, it just reasons
 * about competition from the model's own knowledge instead of live numbers.
 */
export class YouTubeResearch {
  constructor(private readonly apiKey: string | undefined) {}

  get enabled(): boolean {
    return Boolean(this.apiKey);
  }

  async topVideos(query: string, limit = 25): Promise<CompetitorVideo[]> {
    if (!this.apiKey) return [];

    try {
      const search = new URL(`${API}/search`);
      search.searchParams.set('part', 'snippet');
      search.searchParams.set('q', query);
      search.searchParams.set('type', 'video');
      search.searchParams.set('order', 'relevance');
      search.searchParams.set('maxResults', String(Math.min(limit, 50)));
      search.searchParams.set('key', this.apiKey);

      const items = (await fetchJson<{ items?: SearchItem[] }>(search)).items ?? [];
      const ids = items.map((i) => i.id?.videoId).filter((id): id is string => Boolean(id));
      const views = await this.viewCounts(ids);

      const now = Date.now();
      return items
        .map((item): CompetitorVideo | null => {
          const videoId = item.id?.videoId;
          if (!videoId) return null;
          const publishedAt = item.snippet?.publishedAt ?? '';
          const viewCount = views.get(videoId) ?? null;
          const ageDays = publishedAt ? Math.max(1, (now - Date.parse(publishedAt)) / 86_400_000) : null;
          return {
            videoId,
            title: item.snippet?.title ?? '(untitled)',
            channel: item.snippet?.channelTitle ?? '(unknown channel)',
            publishedAt,
            views: viewCount,
            viewsPerDay: viewCount !== null && ageDays !== null ? viewCount / ageDays : null,
          };
        })
        .filter((v): v is CompetitorVideo => v !== null);
    } catch (error) {
      // Research is a nice-to-have. A quota error must not kill the run.
      log.warn({ err: errorMessage(error) }, 'youtube research failed — continuing without live competition data');
      return [];
    }
  }

  private async viewCounts(ids: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (ids.length === 0 || !this.apiKey) return out;

    const url = new URL(`${API}/videos`);
    url.searchParams.set('part', 'statistics');
    url.searchParams.set('id', ids.join(','));
    url.searchParams.set('key', this.apiKey);

    const items = (await fetchJson<{ items?: VideoItem[] }>(url)).items ?? [];
    for (const item of items) {
      const count = Number(item.statistics?.viewCount);
      if (item.id && Number.isFinite(count)) out.set(item.id, count);
    }
    return out;
  }
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`YouTube API ${response.status}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}
