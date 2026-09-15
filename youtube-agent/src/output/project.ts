import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Config } from '../config.js';
import type { ProductionPackage, TopicResearch } from '../types.js';
import { buildSrt } from './subtitles.js';
import { renderThumbnailSvg } from './thumbnail.js';
import { formatTimecode, slugify } from '../utils/index.js';

export interface ProjectPaths {
  dir: string;
  assetDir: string;
  voiceDir: string;
  subtitles: string;
  video: string;
}

/** `out/2026-09-14-how-to-fix-gummy-sourdough/` */
export function projectPaths(cfg: Config, title: string, now = new Date()): ProjectPaths {
  const date = now.toISOString().slice(0, 10);
  const dir = path.resolve(cfg.OUTPUT_DIR, `${date}-${slugify(title)}`);
  return {
    dir,
    assetDir: path.join(dir, 'assets'),
    voiceDir: path.join(dir, 'voiceover'),
    subtitles: path.join(dir, 'subtitles.srt'),
    video: path.join(dir, 'video.mp4'),
  };
}

/** Writes every artefact of a production package into its project folder. */
export async function writeProject(pkg: ProductionPackage, paths: ProjectPaths): Promise<void> {
  await mkdir(path.join(paths.dir, 'thumbnails'), { recursive: true });

  const writes: Promise<unknown>[] = [
    writeFile(path.join(paths.dir, 'plan.json'), `${JSON.stringify(pkg, null, 2)}\n`, 'utf8'),
    writeFile(path.join(paths.dir, 'README.md'), overviewMarkdown(pkg), 'utf8'),
    writeFile(path.join(paths.dir, 'script.md'), scriptMarkdown(pkg), 'utf8'),
    writeFile(path.join(paths.dir, 'teleprompter.txt'), teleprompterText(pkg), 'utf8'),
    writeFile(path.join(paths.dir, 'metadata.md'), metadataMarkdown(pkg), 'utf8'),
    writeFile(path.join(paths.dir, 'shotlist.md'), shotlistMarkdown(pkg), 'utf8'),
    writeFile(paths.subtitles, buildSrt(pkg.scenes), 'utf8'),
  ];

  pkg.thumbnails.forEach((concept, i) => {
    writes.push(
      writeFile(
        path.join(paths.dir, 'thumbnails', `concept-${i + 1}.svg`),
        renderThumbnailSvg(concept, pkg.language),
        'utf8',
      ),
    );
  });
  writes.push(writeFile(path.join(paths.dir, 'thumbnails', 'README.md'), thumbnailMarkdown(pkg), 'utf8'));

  await Promise.all(writes);
}

/** The topic shortlist, written whether or not a video gets produced from it. */
export async function writeTopicReport(research: TopicResearch, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `topics-${slugify(research.niche, 40)}.md`);

  const body = research.ideas
    .map(
      (idea, i) => `## ${i + 1}. ${idea.title}

- **Demand:** ${idea.demandScore}/100 · **Competition:** ${idea.competition}
- **Angle:** ${idea.angle}
- **Hook:** "${idea.hook}"
- **Who watches:** ${idea.audience}
- **They searched for:** ${idea.searchIntent}
- **Why now:** ${idea.whyNow}
- **Keywords:** ${idea.keywords.join(', ') || '—'}
- **Risks:** ${idea.risks.length > 0 ? idea.risks.join('; ') : '—'}`,
    )
    .join('\n\n');

  await writeFile(file, `# Topic ideas — ${research.niche}\n\n${research.summary}\n\n${body}\n`, 'utf8');
  return file;
}

function overviewMarkdown(pkg: ProductionPackage): string {
  const minutes = (pkg.totalDurationSec / 60).toFixed(1);
  const words = pkg.scenes.reduce((sum, s) => sum + s.wordCount, 0);
  const assets = pkg.scenes.reduce((sum, s) => sum + s.assets.filter((a) => a.file).length, 0);

  return `# ${pkg.script.title}

${pkg.script.logline}

| | |
|---|---|
| Estimated runtime | ${minutes} min (${Math.round(pkg.totalDurationSec)}s) |
| Scenes | ${pkg.scenes.length} |
| Narration | ${words} words |
| B-roll downloaded | ${assets} files |
| Language | ${pkg.language} |
| Generated | ${pkg.generatedAt.slice(0, 16).replace('T', ' ')} UTC |

## What is in this folder

| File | Use it for |
|---|---|
| \`script.md\` | The full script, scene by scene, with visuals and editor notes |
| \`teleprompter.txt\` | Narration only — paste into a teleprompter app and record |
| \`subtitles.srt\` | Burn-in or upload captions. Timings are estimates — re-sync after recording |
| \`metadata.md\` | Titles, description, tags, pinned comment — ready to paste |
| \`shotlist.md\` | What to shoot or source for each scene |
| \`thumbnails/\` | Three concepts as editable SVGs |
| \`assets/\` | Stock photos pulled for each scene's b-roll slot |
| \`plan.json\` | Everything above, machine-readable |

## Before you record

- [ ] Pick one title from \`metadata.md\` — the ordering there is a suggestion, not a ranking you have to accept
- [ ] Read the hook out loud. If it sounds like writing rather than speech, cut it down
- [ ] Check every factual claim in the script. This was drafted by a model and is not a source
- [ ] Confirm you can actually source the visuals in \`shotlist.md\`
- [ ] Check the licence on anything in \`assets/\` before it goes into a monetised video

## Why this topic

**${pkg.topic.title}** — ${pkg.topic.angle}

- Demand ${pkg.topic.demandScore}/100, competition ${pkg.topic.competition}
- Why now: ${pkg.topic.whyNow}
${pkg.topic.risks.length > 0 ? `- Watch out for: ${pkg.topic.risks.join('; ')}\n` : ''}`;
}

function scriptMarkdown(pkg: ProductionPackage): string {
  const scenes = pkg.scenes
    .map((scene) => {
      const end = formatTimecode(scene.startSec + scene.durationSec);
      const parts = [
        `## ${formatTimecode(scene.startSec)}–${end} · ${scene.heading}`,
        '',
        scene.narration,
        '',
        `- **On screen:** ${scene.onScreenText || '—'}`,
        `- **Visual:** ${scene.visual}`,
        `- **B-roll search:** \`${scene.brollQuery}\``,
      ];
      if (scene.editorNote) parts.push(`- **Editor:** ${scene.editorNote}`);
      parts.push(`- ${scene.wordCount} words · ${Math.round(scene.durationSec)}s`);
      return parts.join('\n');
    })
    .join('\n\n');

  return `# Script — ${pkg.script.title}

> Timings are estimated at the configured narration pace. They shift once you record.

${scenes}

---

**Call to action:** ${pkg.script.callToAction}
`;
}

function teleprompterText(pkg: ProductionPackage): string {
  return `${pkg.scenes.map((s) => s.narration).join('\n\n')}\n`;
}

function metadataMarkdown(pkg: ProductionPackage): string {
  const titles = pkg.metadata.titles
    .map((t, i) => `${i + 1}. **${t.text}** _(${t.text.length} chars)_\n   ${t.rationale}`)
    .join('\n');

  return `# Metadata — ${pkg.script.title}

## Title options

${titles}

## Description

\`\`\`
${pkg.metadata.description}
\`\`\`

## Tags

\`\`\`
${pkg.metadata.tags.join(', ')}
\`\`\`

## Hashtags

${pkg.metadata.hashtags.join(' ') || '—'}

## Pinned comment

${pkg.metadata.pinnedComment || '—'}
`;
}

function shotlistMarkdown(pkg: ProductionPackage): string {
  const rows = pkg.scenes
    .map((scene) => {
      const files = scene.assets
        .filter((a) => a.file)
        .map((a) => `\`assets/${path.basename(a.file ?? '')}\``)
        .join(', ');
      return `| ${formatTimecode(scene.startSec)} | ${scene.heading} | ${scene.visual.replace(/\|/g, '\\|')} | \`${scene.brollQuery}\` | ${files || '—'} |`;
    })
    .join('\n');

  const credits = pkg.scenes
    .flatMap((s) => s.assets.filter((a) => a.file).map((a) => `- ${a.credit}`))
    .join('\n');

  return `# Shot list — ${pkg.script.title}

| Time | Scene | What the viewer sees | Stock search | Downloaded |
|---|---|---|---|---|
${rows}

${credits ? `## Asset credits\n\n${credits}\n` : '## Assets\n\nNo stock assets were downloaded. Set `PEXELS_API_KEY` to pull them automatically, or search the phrases above by hand.\n'}`;
}

function thumbnailMarkdown(pkg: ProductionPackage): string {
  const concepts = pkg.thumbnails
    .map(
      (c, i) => `## Concept ${i + 1} — \`concept-${i + 1}.svg\`

- **Big text:** ${c.bigText}
- **Sub text:** ${c.subText || '—'}
- **Visual:** ${c.visual}
- **Feeling:** ${c.emotion}
- **Palette:** background \`${c.palette.background}\` · accent \`${c.palette.accent}\` · text \`${c.palette.text}\``,
    )
    .join('\n\n');

  return `# Thumbnail concepts

Each SVG is 1280×720 — YouTube's native thumbnail size. Open one in a browser to
check it, or in Figma, Canva or Illustrator to drop a real photo behind the text
and nudge the layout. Export as JPG under 2 MB before uploading.

Shrink it to 20% before you commit to one. If it stops reading at that size, it
will not work in a sidebar either.

${concepts}
`;
}
