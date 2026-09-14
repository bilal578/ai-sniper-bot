import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage, withTimeout } from '../utils/index.js';
import type { AiVerdict, SafetyReport, TokenCandidate } from '../types.js';

const log = getLogger('ai');

const SYSTEM_PROMPT = `You are a risk analyst for a Solana memecoin sniper bot. You receive a
freshly-launched token together with the results of deterministic on-chain safety checks that
have ALREADY been run. Your job is to judge what those checks cannot: whether the launch looks
organic or engineered.

Weigh these signals:
- Name/symbol quality: impersonating a major brand or an existing token is a strong negative.
- Holder concentration beyond the hard thresholds already applied.
- Liquidity relative to how new the token is.
- Early trade flow: heavy sells against few buys in the first minutes suggests insiders exiting.
- Presence and plausibility of socials. No socials at all is a negative but not disqualifying.
- Anything internally inconsistent (e.g. huge liquidity on a 20-second-old token).

Be strict. The bot risks real funds on every buy, and the base rate of scams in this population
is very high. When signals are thin or contradictory, prefer a low score.

Respond with ONLY a JSON object, no prose and no markdown fences:
{"score": <integer 0-100>, "decision": "buy" | "skip", "reasoning": "<one or two sentences>",
 "risks": ["<short risk>", ...]}`;

export class AiAnalyzer {
  private readonly client: Anthropic | null;

  constructor(private readonly cfg: Config) {
    this.client =
      cfg.ENABLE_AI_ANALYSIS && cfg.ANTHROPIC_API_KEY
        ? new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 1 })
        : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  async analyze(candidate: TokenCandidate, safety: SafetyReport): Promise<AiVerdict> {
    if (!this.client) {
      return {
        score: 100,
        decision: 'buy',
        reasoning: 'AI analysis disabled; relying on deterministic safety checks only.',
        risks: [],
        fallback: true,
      };
    }

    try {
      const response = await withTimeout(
        this.client.messages.create({
          model: this.cfg.AI_MODEL,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildPrompt(candidate, safety) }],
        }),
        this.cfg.AI_TIMEOUT_MS,
        'ai analysis',
      );

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('')
        .trim();

      const verdict = parseVerdict(text);
      log.info({ mint: candidate.mint, score: verdict.score, decision: verdict.decision }, 'ai verdict');
      return verdict;
    } catch (error) {
      log.warn({ mint: candidate.mint, err: errorMessage(error) }, 'ai analysis failed');
      // Fail-closed by default: an unreachable model must not become a free pass.
      return this.cfg.AI_FAIL_OPEN
        ? { score: this.cfg.AI_MIN_SCORE, decision: 'buy', reasoning: 'AI unavailable; fail-open configured.', risks: ['ai_unavailable'], fallback: true }
        : { score: 0, decision: 'skip', reasoning: 'AI unavailable; failing closed.', risks: ['ai_unavailable'], fallback: true };
    }
  }
}

export function buildPrompt(candidate: TokenCandidate, safety: SafetyReport): string {
  const m = safety.metrics;
  const fmt = (v: number | null | undefined, suffix = '', digits = 2): string =>
    v === null || v === undefined || !Number.isFinite(v) ? 'unknown' : `${v.toFixed(digits)}${suffix}`;

  const checkLines = safety.checks
    .map((c) => `  - ${c.name}: ${c.passed ? 'PASS' : 'FAIL'}${c.critical ? ' (critical)' : ''} — ${c.detail}`)
    .join('\n');

  return `TOKEN
  mint: ${candidate.mint}
  name: ${candidate.name ?? 'unknown'}
  symbol: ${candidate.symbol ?? 'unknown'}
  launch venue: ${candidate.source}
  deployer: ${candidate.deployer ?? 'unknown'}
  age: ${fmt(m.ageSeconds, 's', 0)}

MARKET
  liquidity: ${fmt(m.liquiditySol, ' SOL')}
  price: ${m.priceUsd === null ? 'unknown' : `$${m.priceUsd}`}
  5m volume: ${m.volume5mUsd === null ? 'unknown' : `$${m.volume5mUsd.toFixed(0)}`}
  5m buys/sells: ${m.buys5m ?? '?'} / ${m.sells5m ?? '?'}
  total supply: ${fmt(m.supply, '', 0)}

DISTRIBUTION
  top holder: ${fmt(m.topHolderPct, '%')}
  top 10 holders: ${fmt(m.top10HolderPct, '%')}
  accounts sampled: ${m.holderCount ?? 'unknown'}

AUTHORITIES
  mint authority revoked: ${m.mintAuthorityRevoked}
  freeze authority revoked: ${m.freezeAuthorityRevoked}
  transfer fee: ${m.transferFeeBps === null ? 'none (standard SPL mint)' : `${(m.transferFeeBps / 100).toFixed(2)}%`}

SOCIALS
  ${m.socials.length > 0 ? m.socials.join('\n  ') : 'none found'}

DETERMINISTIC CHECKS (score ${safety.score}/100, overall ${safety.passed ? 'PASS' : 'FAIL'})
${checkLines}

Judge this launch.`;
}

/** Tolerates the model wrapping its JSON in prose or a markdown fence. */
export function parseVerdict(text: string): AiVerdict {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`AI response contained no JSON object: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(text.slice(start, end + 1)) as {
    score?: unknown;
    decision?: unknown;
    reasoning?: unknown;
    risks?: unknown;
  };

  const rawScore = Number(parsed.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;

  return {
    score,
    decision: parsed.decision === 'buy' ? 'buy' : 'skip',
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'no reasoning provided',
    risks: Array.isArray(parsed.risks) ? parsed.risks.filter((r): r is string => typeof r === 'string') : [],
    fallback: false,
  };
}
