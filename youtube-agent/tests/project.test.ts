import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { projectPaths, writeProject, writeTopicReport } from '../src/output/project.js';
import { timeScenes, totalDuration } from '../src/output/timing.js';
import type { ProductionPackage, Scene, TopicIdea } from '../src/types.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'ai-tuber-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const topic: TopicIdea = {
  title: 'Why Your Sourdough Is Gummy Inside',
  angle: 'Everyone blames the starter; it is almost always underbaking.',
  hook: 'Your starter is fine. Your oven is lying to you.',
  audience: 'Home bakers on loaf five to twenty',
  searchIntent: 'why is my sourdough gummy',
  keywords: ['gummy sourdough', 'sourdough underbaked'],
  competition: 'medium',
  demandScore: 82,
  whyNow: 'Winter baking season doubles the search volume.',
  risks: ['Several large channels covered the starter angle already'],
};

const scene = (id: string, narration: string): Scene => ({
  id,
  heading: id.replace('-', ' '),
  narration,
  onScreenText: 'GUMMY?',
  visual: 'Cut a loaf open on a wooden board',
  brollQuery: 'sourdough bread slice',
  editorNote: 'hard cut on the knife',
});

function samplePackage(): ProductionPackage {
  const scenes = timeScenes(
    [
      scene('hook', 'Your starter is fine. Your oven is lying to you. Here is the actual problem.'),
      scene('cause', 'Gummy crumb is almost always an underbaked loaf, and the fix takes one thermometer.'),
      scene('cta', 'Bake one more loaf this week and tell me what the centre read.'),
    ],
    2.6,
  );

  return {
    topic,
    script: {
      title: topic.title,
      logline: 'The gummy-crumb problem is a temperature problem.',
      targetDurationSec: 480,
      scenes,
      callToAction: 'Bake one more loaf this week and tell me what the centre read.',
    },
    metadata: {
      titles: [{ text: 'Your Sourdough Is Underbaked', rationale: 'Names the cause in the title.' }],
      description: 'Gummy sourdough is almost never the starter.\n\n0:00 hook\n0:12 cause',
      tags: ['gummy sourdough', 'sourdough troubleshooting'],
      hashtags: ['#sourdough'],
      pinnedComment: 'What did your centre temperature read?',
    },
    thumbnails: [
      {
        bigText: 'NOT THE STARTER',
        subText: 'it is the bake',
        visual: 'Sliced gummy loaf, knife still in frame',
        emotion: 'recognition',
        palette: { background: '#1b1006', accent: '#ffb020', text: '#ffffff' },
      },
    ],
    scenes,
    totalDurationSec: totalDuration(scenes),
    competitors: [],
    language: 'en',
    generatedAt: '2026-09-14T10:00:00.000Z',
    model: 'claude-opus-5',
  };
}

describe('projectPaths', () => {
  it('names the folder by date and slug', () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k', OUTPUT_DIR: dir });
    const paths = projectPaths(cfg, 'Why Your Sourdough Is Gummy Inside', new Date('2026-09-14T00:00:00Z'));
    expect(path.basename(paths.dir)).toBe('2026-09-14-why-your-sourdough-is-gummy-inside');
  });
});

describe('writeProject', () => {
  it('writes every artefact an editor needs', async () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k', OUTPUT_DIR: dir });
    const pkg = samplePackage();
    const paths = projectPaths(cfg, pkg.script.title);

    await writeProject(pkg, paths);

    const files = await readdir(paths.dir);
    expect(files.sort()).toEqual([
      'README.md',
      'metadata.md',
      'plan.json',
      'script.md',
      'shotlist.md',
      'subtitles.srt',
      'teleprompter.txt',
      'thumbnails',
    ]);

    const thumbnails = await readdir(path.join(paths.dir, 'thumbnails'));
    expect(thumbnails.sort()).toEqual(['README.md', 'concept-1.svg']);
  });

  it('round-trips plan.json', async () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k', OUTPUT_DIR: dir });
    const pkg = samplePackage();
    const paths = projectPaths(cfg, pkg.script.title);

    await writeProject(pkg, paths);
    const parsed = JSON.parse(await readFile(path.join(paths.dir, 'plan.json'), 'utf8')) as ProductionPackage;

    expect(parsed.script.title).toBe(pkg.script.title);
    expect(parsed.scenes).toHaveLength(3);
    expect(parsed.totalDurationSec).toBeCloseTo(pkg.totalDurationSec, 5);
  });

  it('puts only the spoken words in the teleprompter file', async () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k', OUTPUT_DIR: dir });
    const pkg = samplePackage();
    const paths = projectPaths(cfg, pkg.script.title);

    await writeProject(pkg, paths);
    const text = await readFile(path.join(paths.dir, 'teleprompter.txt'), 'utf8');

    expect(text).toContain('Your starter is fine.');
    expect(text).not.toContain('hard cut on the knife');
    expect(text).not.toContain('sourdough bread slice');
  });

  it('tells the reader how to source b-roll when nothing was downloaded', async () => {
    const cfg = loadConfig({ ANTHROPIC_API_KEY: 'k', OUTPUT_DIR: dir });
    const pkg = samplePackage();
    const paths = projectPaths(cfg, pkg.script.title);

    await writeProject(pkg, paths);
    const shotlist = await readFile(path.join(paths.dir, 'shotlist.md'), 'utf8');

    expect(shotlist).toContain('PEXELS_API_KEY');
    expect(shotlist).toContain('sourdough bread slice');
  });
});

describe('writeTopicReport', () => {
  it('writes a ranked shortlist', async () => {
    const file = await writeTopicReport(
      { niche: 'sourdough baking', summary: 'Troubleshooting beats recipes here.', ideas: [topic] },
      dir,
    );

    const body = await readFile(file, 'utf8');
    expect(path.basename(file)).toBe('topics-sourdough-baking.md');
    expect(body).toContain('# Topic ideas — sourdough baking');
    expect(body).toContain('82/100');
    expect(body).toContain(topic.hook);
  });
});
