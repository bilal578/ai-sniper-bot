import type { Config } from './config.js';
import { ClaudeClient } from './ai/client.js';
import {
  METADATA_SYSTEM,
  SCRIPT_SYSTEM,
  THUMBNAIL_SYSTEM,
  TOPIC_SYSTEM,
  buildChapters,
  metadataPrompt,
  scriptPrompt,
  thumbnailPrompt,
  topicPrompt,
} from './ai/prompts.js';
import { PexelsClient, downloadAsset } from './media/pexels.js';
import { YouTubeResearch } from './media/youtube.js';
import { timeScenes, totalDuration } from './output/timing.js';
import {
  thumbnailSetSchema,
  topicResearchSchema,
  videoMetadataSchema,
  videoScriptSchema,
  type CompetitorVideo,
  type ProductionPackage,
  type TimedScene,
  type TopicIdea,
  type TopicResearch,
} from './types.js';
import { getLogger } from './logger.js';
import { slugify } from './utils/index.js';

const log = getLogger('pipeline');

export interface ResearchResult {
  research: TopicResearch;
  competitors: CompetitorVideo[];
}

/** Step 1: what should this channel make next, and why. */
export async function researchTopics(cfg: Config, claude: ClaudeClient, niche: string): Promise<ResearchResult> {
  const youtube = new YouTubeResearch(cfg.YOUTUBE_API_KEY);
  const competitors = await youtube.topVideos(niche);
  log.info({ niche, competitors: competitors.length, liveData: youtube.enabled }, 'researching topics');

  const research = await claude.completeJson(
    {
      label: 'topics',
      system: TOPIC_SYSTEM,
      prompt: topicPrompt(cfg, niche, competitors, ''),
      webSearch: cfg.ENABLE_WEB_SEARCH,
      maxTokens: 16_000,
    },
    topicResearchSchema,
  );

  research.ideas.sort((a, b) => b.demandScore - a.demandScore);
  return { research, competitors };
}

/** Step 2: turn one topic into a complete, timed production package. */
export async function produce(
  cfg: Config,
  claude: ClaudeClient,
  topic: TopicIdea,
  competitors: CompetitorVideo[] = [],
): Promise<ProductionPackage> {
  log.info({ title: topic.title }, 'writing script');
  const script = await claude.completeJson(
    { label: 'script', system: SCRIPT_SYSTEM, prompt: scriptPrompt(cfg, topic) },
    videoScriptSchema,
  );

  const scenes = timeScenes(script.scenes, cfg.WORDS_PER_SECOND);
  const chapters = buildChapters(scenes);

  // Metadata and thumbnails only depend on the finished script, so they run
  // together rather than one after the other.
  log.info({ scenes: scenes.length, seconds: Math.round(totalDuration(scenes)) }, 'packaging');
  const [metadata, thumbnails] = await Promise.all([
    claude.completeJson(
      {
        label: 'metadata',
        system: METADATA_SYSTEM,
        prompt: metadataPrompt(cfg, topic, script, chapters),
        maxTokens: 16_000,
      },
      videoMetadataSchema,
    ),
    claude.completeJson(
      {
        label: 'thumbnails',
        system: THUMBNAIL_SYSTEM,
        prompt: thumbnailPrompt(cfg, topic, script),
        maxTokens: 8_000,
      },
      thumbnailSetSchema,
    ),
  ]);

  return {
    topic,
    script,
    metadata,
    thumbnails: thumbnails.concepts,
    scenes,
    totalDurationSec: totalDuration(scenes),
    competitors,
    language: cfg.CONTENT_LANGUAGE,
    generatedAt: new Date().toISOString(),
    model: cfg.AI_MODEL,
  };
}

/**
 * Step 3 (optional): pull real stock photos for each scene's b-roll slot.
 * Without a Pexels key the queries still land in broll.md to source by hand.
 */
export async function attachBroll(cfg: Config, scenes: TimedScene[], assetDir: string): Promise<number> {
  const pexels = new PexelsClient(cfg.PEXELS_API_KEY);
  if (!pexels.enabled || cfg.BROLL_PER_SCENE < 1) return 0;

  let downloaded = 0;
  for (const scene of scenes) {
    const query = scene.brollQuery.trim();
    if (!query) continue;

    const results = await pexels.searchPhotos(query, cfg.BROLL_PER_SCENE);
    for (const [i, asset] of results.slice(0, cfg.BROLL_PER_SCENE).entries()) {
      const basename = `${String(scene.index + 1).padStart(2, '0')}-${slugify(scene.id, 24)}-${i + 1}`;
      const file = await downloadAsset(asset, assetDir, basename);
      scene.assets.push({ ...asset, sceneId: scene.id, ...(file ? { file } : {}) });
      if (file) downloaded += 1;
    }
  }

  log.info({ downloaded }, 'b-roll attached');
  return downloaded;
}

/**
 * `plan "<some title>"` skips the research step, but the script prompt is much
 * stronger with an angle and an audience than with a bare title — so fill those
 * in with one cheap call rather than leaving them blank.
 */
export async function expandTopic(cfg: Config, claude: ClaudeClient, title: string): Promise<TopicIdea> {
  return claude.completeJson(
    {
      label: 'topic-expand',
      system: TOPIC_SYSTEM,
      prompt: `${topicPrompt(cfg, title, [], 'The user has already chosen this exact video. Do not propose alternatives.')}

Override: return exactly ONE idea, and its "title" must stay "${title}" (you may fix
obvious typos only). Fill in the angle, hook, audience, search intent and risks for it.`,
      maxTokens: 8_000,
    },
    topicResearchSchema,
  ).then((research) => {
    const idea = research.ideas[0];
    if (!idea) throw new Error('Claude returned no topic for that title.');
    return { ...idea, title };
  });
}
