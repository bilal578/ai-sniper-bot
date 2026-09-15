import { z } from 'zod';

/**
 * Zod schemas do double duty: they document the shape we ask Claude for, and
 * they are the gate that stops a malformed generation from being written to
 * disk as if it were a finished production package.
 */

export const topicIdeaSchema = z.object({
  title: z.string().min(3),
  angle: z.string(),
  hook: z.string(),
  audience: z.string(),
  searchIntent: z.string(),
  keywords: z.array(z.string()).default([]),
  competition: z.enum(['low', 'medium', 'high']),
  /** How much appetite there is for this video right now, 0-100. */
  demandScore: z.number().min(0).max(100),
  whyNow: z.string(),
  risks: z.array(z.string()).default([]),
});
export type TopicIdea = z.infer<typeof topicIdeaSchema>;

export const topicResearchSchema = z.object({
  niche: z.string(),
  summary: z.string(),
  ideas: z.array(topicIdeaSchema).min(1),
});
export type TopicResearch = z.infer<typeof topicResearchSchema>;

export const sceneSchema = z.object({
  /** Short label, e.g. "hook", "problem", "step-2", "cta". */
  id: z.string(),
  heading: z.string(),
  /** Exactly what the voiceover says. This is what gets read and timed. */
  narration: z.string().min(1),
  /** Big words burned onto the screen for this beat. Keep it short. */
  onScreenText: z.string().default(''),
  /** Direction for the editor: what the viewer is looking at. */
  visual: z.string(),
  /** Stock-footage search phrase for this beat. */
  brollQuery: z.string(),
  /** Optional editing note: cut, zoom, sfx, graph to build, etc. */
  editorNote: z.string().default(''),
});
export type Scene = z.infer<typeof sceneSchema>;

export const videoScriptSchema = z.object({
  title: z.string(),
  logline: z.string(),
  targetDurationSec: z.number().positive(),
  scenes: z.array(sceneSchema).min(2),
  callToAction: z.string(),
});
export type VideoScript = z.infer<typeof videoScriptSchema>;

export const titleOptionSchema = z.object({
  text: z.string().min(3),
  rationale: z.string(),
});

export const videoMetadataSchema = z.object({
  titles: z.array(titleOptionSchema).min(1),
  description: z.string(),
  tags: z.array(z.string()).default([]),
  hashtags: z.array(z.string()).default([]),
  pinnedComment: z.string().default(''),
});
export type VideoMetadata = z.infer<typeof videoMetadataSchema>;

export const thumbnailConceptSchema = z.object({
  /** Three or four words, maximum. Anything longer is unreadable on a phone. */
  bigText: z.string(),
  subText: z.string().default(''),
  visual: z.string(),
  emotion: z.string(),
  palette: z.object({
    background: z.string(),
    accent: z.string(),
    text: z.string(),
  }),
});
export type ThumbnailConcept = z.infer<typeof thumbnailConceptSchema>;

export const thumbnailSetSchema = z.object({
  concepts: z.array(thumbnailConceptSchema).min(1),
});

/** A scene once we have attached timings and downloaded assets. */
export interface TimedScene extends Scene {
  index: number;
  wordCount: number;
  startSec: number;
  durationSec: number;
  assets: BrollAsset[];
}

export interface BrollAsset {
  sceneId: string;
  query: string;
  kind: 'photo' | 'video';
  url: string;
  credit: string;
  /** Relative path inside the project folder, once downloaded. */
  file?: string;
}

/** A competing video pulled from the YouTube Data API. */
export interface CompetitorVideo {
  videoId: string;
  title: string;
  channel: string;
  publishedAt: string;
  views: number | null;
  /** Views per day since publication — a crude but useful demand signal. */
  viewsPerDay: number | null;
}

/** Everything one `plan` run produced. Written to disk as plan.json. */
export interface ProductionPackage {
  topic: TopicIdea;
  script: VideoScript;
  metadata: VideoMetadata;
  thumbnails: ThumbnailConcept[];
  scenes: TimedScene[];
  totalDurationSec: number;
  competitors: CompetitorVideo[];
  language: string;
  generatedAt: string;
  model: string;
}
