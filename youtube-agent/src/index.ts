#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, redactConfig, type Config } from './config.js';
import { runDoctor } from './doctor.js';
import { initLogger, getLogger } from './logger.js';
import { ClaudeClient, estimateCostUsd } from './ai/client.js';
import { attachBroll, expandTopic, produce, researchTopics } from './pipeline.js';
import { hasFfmpeg, renderVideo } from './media/render.js';
import { synthesizeVoiceover } from './media/tts.js';
import { projectPaths, writeProject, writeTopicReport, type ProjectPaths } from './output/project.js';
import type { ProductionPackage } from './types.js';
import { errorMessage, formatTimecode } from './utils/index.js';

const HELP = `
ai-tuber — an AI agent that researches YouTube topics and writes the whole video package

Usage:
  ai-tuber doctor                 Check your setup before spending anything
  ai-tuber topics "<niche>"       Research and rank video ideas for a niche
  ai-tuber plan "<video title>"   Full production package for a topic you already picked
  ai-tuber make "<niche>"         Research, pick the strongest idea, then produce it
  ai-tuber render <project-dir>   Assemble a rough-cut MP4 from a finished package (needs ffmpeg)
  ai-tuber config                 Print the resolved configuration (keys redacted)
  ai-tuber help                   Show this message

Flags:
  --pick=N        With "make": produce idea N from the ranking instead of the top one
  --no-broll      Skip downloading stock assets
  --voice         Render narration audio (needs TTS_PROVIDER and its API key)
  --render        Assemble the rough-cut MP4 straight after producing (needs ffmpeg)

Each run writes a folder under OUTPUT_DIR containing the script, teleprompter text,
subtitles, metadata, shot list and thumbnail concepts.

Configuration is read from .env — see .env.example for every option.
`;

async function main(): Promise<void> {
  const [command = 'help', ...rest] = process.argv.slice(2);

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(HELP);
    return;
  }

  // Runs before loadConfig on purpose: reporting a broken config is its job, so
  // it must not die on the same error it exists to explain.
  if (command === 'doctor') {
    process.exit(await runDoctor());
  }

  const cfg = loadConfig();
  initLogger(cfg.LOG_LEVEL, cfg.LOG_PRETTY);
  const log = getLogger('cli');

  const flags = new Set(rest.filter((arg) => arg.startsWith('--')));
  const args = rest.filter((arg) => !arg.startsWith('--'));
  const subject = args.join(' ').trim();

  switch (command) {
    case 'config': {
      process.stdout.write(`${JSON.stringify(redactConfig(cfg), null, 2)}\n`);
      return;
    }

    case 'topics': {
      requireSubject(subject, 'topics', 'sourdough baking for beginners');
      const claude = new ClaudeClient(cfg);
      const { research } = await researchTopics(cfg, claude, subject);
      const file = await writeTopicReport(research, path.resolve(cfg.OUTPUT_DIR));

      process.stdout.write(`\n${research.summary}\n\n`);
      research.ideas.forEach((idea, i) => {
        process.stdout.write(
          `  ${String(i + 1).padStart(2)}. [${String(idea.demandScore).padStart(3)}/100 · ${idea.competition.padEnd(6)}] ${idea.title}\n`,
        );
      });
      process.stdout.write(`\nWritten to ${file}\n`);
      process.stdout.write(`Produce one with:  ai-tuber make "${subject}" --pick=1\n`);
      printSpend(claude);
      return;
    }

    case 'plan': {
      requireSubject(subject, 'plan', 'Why your sourdough is gummy inside');
      const claude = new ClaudeClient(cfg);
      const topic = await expandTopic(cfg, claude, subject);
      await producePackage(cfg, claude, topic, flags);
      return;
    }

    case 'make': {
      requireSubject(subject, 'make', 'sourdough baking for beginners');
      const claude = new ClaudeClient(cfg);
      const { research, competitors } = await researchTopics(cfg, claude, subject);
      await writeTopicReport(research, path.resolve(cfg.OUTPUT_DIR));

      const pick = pickIndex(flags, research.ideas.length);
      const topic = research.ideas[pick];
      if (!topic) throw new Error(`--pick is out of range: only ${research.ideas.length} ideas were returned.`);

      log.info({ pick: pick + 1, title: topic.title, demand: topic.demandScore }, 'producing');
      await producePackage(cfg, claude, topic, flags, competitors);
      return;
    }

    case 'render': {
      const dir = path.resolve(subject || '.');
      const pkg = JSON.parse(await readFile(path.join(dir, 'plan.json'), 'utf8')) as ProductionPackage;
      const paths = { dir, assetDir: path.join(dir, 'assets'), voiceDir: path.join(dir, 'voiceover'), subtitles: path.join(dir, 'subtitles.srt'), video: path.join(dir, 'video.mp4') };
      const out = await renderRoughCut(pkg, paths);
      process.stdout.write(`\nRough cut: ${out}\n\n`);
      return;
    }

    default:
      process.stderr.write(`Unknown command: ${command}\n${HELP}`);
      process.exit(1);
  }
}

async function producePackage(
  cfg: Config,
  claude: ClaudeClient,
  topic: Parameters<typeof produce>[2],
  flags: Set<string>,
  competitors: Parameters<typeof produce>[3] = [],
): Promise<void> {
  const pkg = await produce(cfg, claude, topic, competitors);
  const paths = projectPaths(cfg, pkg.script.title);

  if (!flags.has('--no-broll')) {
    await attachBroll(cfg, pkg.scenes, paths.assetDir);
  }

  await writeProject(pkg, paths);

  if (flags.has('--voice')) {
    const voice = await synthesizeVoiceover(cfg, pkg.scenes, paths.voiceDir);
    if (voice) process.stdout.write(`\nVoiceover: ${voice.files.length} clips in ${paths.voiceDir}\n`);
  }

  process.stdout.write(`\n${pkg.script.title}\n`);
  process.stdout.write(`${'─'.repeat(Math.min(72, pkg.script.title.length))}\n`);
  process.stdout.write(`  runtime   ~${formatTimecode(pkg.totalDurationSec)} across ${pkg.scenes.length} scenes\n`);
  process.stdout.write(`  titles    ${pkg.metadata.titles.length} options in metadata.md\n`);
  process.stdout.write(`  thumbs    ${pkg.thumbnails.length} concepts in thumbnails/\n`);
  process.stdout.write(`  folder    ${paths.dir}\n`);
  printSpend(claude);

  if (flags.has('--render')) {
    const out = await renderRoughCut(pkg, paths);
    process.stdout.write(`Rough cut: ${out}\n\n`);
  } else if (await hasFfmpeg()) {
    process.stdout.write(`Assemble a rough cut with:  ai-tuber render "${paths.dir}"\n\n`);
  } else {
    process.stdout.write('\n');
  }
}

async function renderRoughCut(pkg: ProductionPackage, paths: ProjectPaths): Promise<string> {
  const audioFiles = await voiceoverFiles(paths.voiceDir);
  return renderVideo({
    scenes: pkg.scenes,
    projectDir: paths.dir,
    audioFiles,
    subtitlePath: paths.subtitles,
    outputPath: paths.video,
  });
}

/** Scene audio is named NN-slug.mp3, so lexical order is scene order. */
async function voiceoverFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir);
    return entries
      .filter((f) => f.endsWith('.mp3'))
      .sort()
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function pickIndex(flags: Set<string>, available: number): number {
  const flag = [...flags].find((f) => f.startsWith('--pick='));
  if (!flag) return 0;
  const value = Number(flag.slice('--pick='.length));
  if (!Number.isInteger(value) || value < 1 || value > available) {
    throw new Error(`--pick must be between 1 and ${available}.`);
  }
  return value - 1;
}

function requireSubject(subject: string, command: string, example: string): void {
  if (!subject) throw new Error(`${command} needs a subject, e.g.  ai-tuber ${command} "${example}"`);
}

function printSpend(claude: ClaudeClient): void {
  const totals = claude.totals;
  process.stdout.write(
    `  spend     ~$${estimateCostUsd(totals).toFixed(2)} (${totals.calls} calls, ${totals.inputTokens.toLocaleString('en-US')} in / ${totals.outputTokens.toLocaleString('en-US')} out)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`\n${errorMessage(error)}\n\n`);
  process.exit(1);
});
