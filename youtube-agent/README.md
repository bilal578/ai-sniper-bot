# ai-tuber

An AI agent that does the part of YouTube that takes the longest: deciding what
to make, and writing it.

You give it a niche. It researches what is already ranking, proposes topics and
ranks them by real demand, writes the full script timed to your target length,
then packages everything around it — five title options, a pasteable
description with chapters, tags, a shot list, subtitles, and three thumbnail
concepts as editable SVGs.

You record and edit. That part stays yours.

```
ai-tuber make "sourdough baking for beginners"
```

```
out/2026-09-15-why-your-sourdough-is-gummy-inside/
├── README.md           what this video is, and a pre-record checklist
├── script.md           scene by scene, with timings, visuals and editor notes
├── teleprompter.txt    narration only — paste into a teleprompter and record
├── subtitles.srt       captions, timed from the word counts
├── metadata.md         5 titles, description with chapters, tags, pinned comment
├── shotlist.md         what to show in every scene, with stock search phrases
├── thumbnails/         3 concepts as 1280×720 SVGs you can edit in Figma or Canva
├── assets/             stock photos pulled for each scene (needs a Pexels key)
└── plan.json           all of the above, machine-readable
```

## Setup

Needs Node 20 or newer.

```bash
cd youtube-agent
npm install
cp .env.example .env     # put your ANTHROPIC_API_KEY in it
npm run build
npm run doctor           # checks keys, model access and optional tools
```

`doctor` tells you what is missing and what is merely optional before anything
costs money. Only `ANTHROPIC_API_KEY` is required.

## Commands

```bash
# Research and rank ideas — no script, just the shortlist
node dist/index.js topics "home espresso"

# Full production package for a topic you already chose
node dist/index.js plan "Why your espresso tastes sour"

# Research, take the strongest idea, and produce it
node dist/index.js make "home espresso"

# Produce the third idea from the ranking instead of the first
node dist/index.js make "home espresso" --pick=3

# Assemble a rough-cut MP4 from a finished package (needs ffmpeg)
node dist/index.js render "out/2026-09-15-why-your-espresso-tastes-sour"
```

During development, `npm run dev -- make "home espresso"` skips the build step.

### Flags

| Flag | Effect |
|---|---|
| `--pick=N` | With `make`: produce idea N from the ranking instead of the top one |
| `--no-broll` | Skip downloading stock assets |
| `--voice` | Render narration audio (needs `TTS_PROVIDER` and its key) |
| `--render` | Assemble the rough-cut MP4 right after producing |

## How it works

```
niche
  │
  ├─→ YouTube Data API ──→ what is already ranking: titles, views, views/day
  │                                    │
  ├─→ Claude (+ optional web search) ──┴─→ ranked topic ideas, scored by demand
  │                                          │
  │                                     you pick one (or --pick=N)
  │                                          │
  ├─→ Claude ──→ the script: scenes, narration, on-screen text, visuals, b-roll cues
  │                  │
  │             word counts → timings → chapters and subtitles
  │                  │
  ├─→ Claude ──→ titles, description, tags, pinned comment   ┐ these two run
  ├─→ Claude ──→ thumbnail concepts → 1280×720 SVGs          ┘ in parallel
  │
  ├─→ Pexels ──→ stock photos per scene          (optional)
  ├─→ ElevenLabs ──→ narration audio per scene   (optional)
  └─→ ffmpeg ──→ rough-cut MP4                   (optional)
```

Four Claude calls per video: research, script, metadata, thumbnails. The last
two run concurrently. Every run prints what it spent.

## Cost

Roughly **$0.20–$0.60 per video** on `claude-opus-5` at default settings, most
of it in the script call. `ai-tuber topics` alone is a few cents.

Turn it down with `AI_EFFORT=medium`, or `AI_MODEL=claude-sonnet-5` for about a
third of the price — the script gets noticeably more generic, but the metadata
and thumbnail steps hold up fine.

`ENABLE_WEB_SEARCH=true` adds search costs on top, per run.

## Languages

Set `CONTENT_LANGUAGE` and everything the viewer sees is written in it —
narration, titles, description, on-screen text, thumbnail text. B-roll search
phrases stay in English so Pexels can match them.

Right-to-left languages (Urdu, Arabic, Farsi, Hebrew) are laid out correctly in
the thumbnail SVGs. If you record in Urdu or Hindi, drop `WORDS_PER_SECOND` to
around 2.2 — the default pace is tuned for English and will under-estimate your
runtime otherwise.

## The optional pieces

**YouTube Data API** — without a key, topic research still works, but Claude
judges competition from what it already knows rather than live numbers. With a
key it sees the actual titles, view counts and views-per-day of what is ranking.
Free tier is 10,000 units/day; a research run costs about 101.

**Pexels** — without a key, the b-roll search phrases go into `shotlist.md` for
you to source by hand. With one, two landscape photos per scene are downloaded
into `assets/` with photographer credits. Free.

**ElevenLabs** (`--voice`) — renders one MP3 per scene into `voiceover/`.
Per-scene files rather than one long track, so you can drop each clip onto its
own cut. `eleven_multilingual_v2` handles Urdu and Hindi.

**ffmpeg** (`render`) — assembles a slideshow: one still per scene, narration
underneath, subtitles burned in. This is a pacing check, not a finished edit.
When per-scene voiceover exists the renderer times each slide to its real audio
length instead of the estimate.

```bash
brew install ffmpeg          # macOS
sudo apt install ffmpeg      # Ubuntu
winget install Gyan.FFmpeg   # Windows
```

## Things worth knowing

**Subtitle timings are estimates.** They come from word counts at
`WORDS_PER_SECOND`, not from audio. Re-sync them after you record — or render a
voiceover first, which gives the renderer real durations to work from.

**Check the facts.** The script is drafted by a language model. It is a first
draft from a fast writer, not a source. Every claim in it is yours to verify
before it goes out under your name.

**The thumbnails are starting points.** An SVG with text on a gradient will not
out-click a real photograph of a real thing. Open the concept in Figma or Canva,
put a real image behind the text, and keep the layout.

**There is no auto-upload.** Nothing here touches your YouTube account. The
package is files on disk; you review them and upload yourself.

## Configuration

Every option lives in `.env` — see [`.env.example`](.env.example), which
documents each one. `node dist/index.js config` prints the resolved
configuration with keys redacted.

## Development

```bash
npm run typecheck
npm run lint
npm test
```

## License

MIT
