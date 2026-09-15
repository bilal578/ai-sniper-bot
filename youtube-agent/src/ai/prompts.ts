import type { Config } from '../config.js';
import type { CompetitorVideo, TopicIdea, VideoScript } from '../types.js';
import { formatTimecode } from '../utils/index.js';

/**
 * Shared preamble. Every step gets the same picture of the channel so the
 * script, the title and the thumbnail all sound like they came from one person.
 */
export function channelBrief(cfg: Config): string {
  return `CHANNEL
  name: ${cfg.CHANNEL_NAME ?? '(unnamed — write so it works for any small channel)'}
  niche: ${cfg.CHANNEL_NICHE ?? '(not fixed)'}
  audience: ${cfg.CHANNEL_AUDIENCE}
  tone: ${cfg.CHANNEL_TONE}
  language: write ALL viewer-facing text in "${cfg.CONTENT_LANGUAGE}" (narration, titles,
    description, on-screen text). Keep field names and b-roll search queries in English
    so stock-footage sites can match them.`;
}

export const TOPIC_SYSTEM = `You are a YouTube strategist who has grown several channels from zero.
You pick video topics, and you are judged only on whether the video gets watched.

How you choose:
- Demand first. A topic people are already searching for or already arguing about beats a
  topic that is merely interesting.
- Specific beats broad. "Why your sourdough is gummy inside" beats "sourdough tips".
- A topic needs a real answer. If the video cannot deliver something concrete in the first
  minute, it is a bad topic no matter how good the title sounds.
- Be honest about competition. If three large channels covered it last month with better
  production, say so and score it down.
- No clickbait you cannot pay off. A title that promises more than the video delivers costs
  the channel more than the click is worth.

demandScore is 0-100 and must be earned: 80+ only for topics with clear, current,
unmet demand. Spread the scores — do not give everything a 70.`;

export function topicPrompt(
  cfg: Config,
  niche: string,
  competitors: CompetitorVideo[],
  extraContext: string,
): string {
  return `${channelBrief(cfg)}

REQUEST
Propose ${cfg.TOPIC_COUNT} video topics for this niche: "${niche}"
Target video length: about ${Math.round(cfg.TARGET_DURATION_SEC / 60)} minutes.

${competitorBlock(competitors)}
${extraContext ? `\nADDITIONAL CONTEXT\n${extraContext}\n` : ''}
Rank them best-first. Return JSON:
{
  "niche": "<the niche, echoed back>",
  "summary": "<2-3 sentences: what is actually working in this niche right now and where the gap is>",
  "ideas": [
    {
      "title": "<the video title as it would appear on YouTube>",
      "angle": "<what makes this different from what already exists>",
      "hook": "<the literal first sentence of the video>",
      "audience": "<who clicks this>",
      "searchIntent": "<what the viewer typed or wondered before landing here>",
      "keywords": ["<search phrase>", "..."],
      "competition": "low" | "medium" | "high",
      "demandScore": <0-100>,
      "whyNow": "<why this is worth making this month>",
      "risks": ["<what could make this video flop>", "..."]
    }
  ]
}`;
}

function competitorBlock(competitors: CompetitorVideo[]): string {
  if (competitors.length === 0) {
    return `COMPETING VIDEOS
  (none supplied — no YouTube API key was configured, so judge competition from what
   you already know about this niche and say when you are uncertain)`;
  }
  const rows = competitors
    .slice(0, 25)
    .map(
      (v) =>
        `  - "${v.title}" — ${v.channel}, ${v.views === null ? 'views unknown' : `${v.views.toLocaleString('en-US')} views`}` +
        `${v.viewsPerDay === null ? '' : ` (~${Math.round(v.viewsPerDay).toLocaleString('en-US')}/day)`}, published ${v.publishedAt.slice(0, 10)}`,
    )
    .join('\n');
  return `COMPETING VIDEOS ALREADY RANKING FOR THIS NICHE\n${rows}`;
}

export const SCRIPT_SYSTEM = `You are a YouTube scriptwriter who is measured on audience retention.

Rules you do not break:
- The first 15 seconds decide the video. Open on the payoff or the tension, never on
  "hey guys, welcome back to the channel" and never on a channel intro.
- Write spoken language. Short sentences. Contractions. No sentence a person would not
  say out loud. No "in today's video we will explore".
- Every 20-30 seconds something must change: a new fact, a turn, a question, a visual beat.
  If a scene is just restating the previous scene, cut it.
- Be concrete. Numbers, names, specific examples. Delete any sentence that would still be
  true if the topic were different.
- Earn the ending. The call to action comes after you have delivered the thing you promised,
  and it is one line, not a speech.
- No filler, no padding to hit a length. A tight 6 minutes beats a loose 10.

The narration field is read aloud verbatim, so write it exactly as it should be spoken —
no stage directions, no brackets, no "[pause]".`;

export function scriptPrompt(cfg: Config, topic: TopicIdea): string {
  const targetWords = Math.round(cfg.TARGET_DURATION_SEC * cfg.WORDS_PER_SECOND);
  const sceneCount = Math.max(5, Math.min(18, Math.round(cfg.TARGET_DURATION_SEC / 35)));

  return `${channelBrief(cfg)}

VIDEO
  title: ${topic.title}
  angle: ${topic.angle}
  hook the strategist suggested: ${topic.hook}
  who is watching: ${topic.audience}
  what they wanted to know: ${topic.searchIntent}

LENGTH BUDGET
  target runtime: ${cfg.TARGET_DURATION_SEC} seconds (~${Math.round(cfg.TARGET_DURATION_SEC / 60)} min)
  narration pace: ${cfg.WORDS_PER_SECOND} words/second
  so the narration across ALL scenes should total roughly ${targetWords} words.
  Aim for about ${sceneCount} scenes. Timings are computed from your word counts, so the
  word budget is the real constraint — respect it.

Write the full script. Return JSON:
{
  "title": "<final spoken/working title>",
  "logline": "<one sentence describing the video>",
  "targetDurationSec": ${cfg.TARGET_DURATION_SEC},
  "scenes": [
    {
      "id": "<short slug: hook, context, step-1, mistake-2, cta...>",
      "heading": "<what this beat is, for the editor>",
      "narration": "<the exact words spoken in this scene>",
      "onScreenText": "<big text burned on screen, max 6 words, or empty string>",
      "visual": "<what the viewer sees — be specific enough to shoot or source it>",
      "brollQuery": "<2-4 word stock footage search phrase, in English>",
      "editorNote": "<cut, zoom, sfx, graphic to build, or empty string>"
    }
  ],
  "callToAction": "<the one-line CTA, also present as the last scene's narration>"
}`;
}

export const METADATA_SYSTEM = `You package YouTube videos. Titles, descriptions, tags.

- Titles: under 60 characters so they survive mobile truncation. The promise in the title
  must be one the script actually keeps. No ALL CAPS, no "you won't believe".
- Give genuinely different options, not one title reworded five times: lead with the
  outcome, lead with the mistake, lead with the question, lead with the number.
- Description: first two lines are what shows above the fold — they sell the click and
  repeat the main keyword naturally. Then a short summary, then chapters, then anything else.
- Tags: real search phrases people type, not single generic words.`;

export function metadataPrompt(cfg: Config, topic: TopicIdea, script: VideoScript, chapters: string): string {
  return `${channelBrief(cfg)}

VIDEO
  working title: ${script.title}
  logline: ${script.logline}
  search intent: ${topic.searchIntent}
  keywords the strategist flagged: ${topic.keywords.join(', ') || '(none)'}

SCRIPT (narration only)
${script.scenes.map((s) => `[${s.id}] ${s.narration}`).join('\n\n').slice(0, 12_000)}

CHAPTERS (already timed — paste these into the description as-is)
${chapters}

Return JSON:
{
  "titles": [{ "text": "<title>", "rationale": "<why this one would get the click>" }, ... 5 of them],
  "description": "<the full description, including the chapter list above, ready to paste>",
  "tags": ["<search phrase>", ... 15-25 of them],
  "hashtags": ["#<tag>", ... 3 of them],
  "pinnedComment": "<a comment that starts a real conversation, not 'what do you think?'>"
}`;
}

export const THUMBNAIL_SYSTEM = `You design YouTube thumbnails that are read on a 4-inch screen
in under half a second.

- Three or four words maximum in the big text. Four is already pushing it.
- The text must say something the title does not. A thumbnail that repeats the title
  wastes half the click surface.
- One subject, one idea, high contrast, readable at 20% size.
- Colour: pick a background that does not blend into YouTube's white and dark themes.
- Give hex codes.`;

export function thumbnailPrompt(cfg: Config, topic: TopicIdea, script: VideoScript): string {
  return `${channelBrief(cfg)}

VIDEO
  title: ${script.title}
  logline: ${script.logline}
  hook: ${script.scenes[0]?.narration.slice(0, 300) ?? topic.hook}

Give 3 distinct thumbnail concepts, best first. Return JSON:
{
  "concepts": [
    {
      "bigText": "<3-4 words, in ${cfg.CONTENT_LANGUAGE}>",
      "subText": "<optional smaller line, or empty string>",
      "visual": "<what is in the frame and where>",
      "emotion": "<what the viewer should feel in that half second>",
      "palette": { "background": "#RRGGBB", "accent": "#RRGGBB", "text": "#RRGGBB" }
    }
  ]
}`;
}

/** YouTube chapter list. The first entry must be 0:00 or YouTube ignores all of them. */
export function buildChapters(scenes: { heading: string; startSec: number }[]): string {
  return scenes.map((s, i) => `${i === 0 ? '0:00' : formatTimecode(s.startSec)} ${s.heading}`).join('\n');
}
