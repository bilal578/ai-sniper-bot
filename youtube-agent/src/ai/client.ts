import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import type { Config } from '../config.js';
import { getLogger } from '../logger.js';
import { errorMessage, withTimeout } from '../utils/index.js';

const log = getLogger('claude');

export interface CompleteOptions {
  /** Human label used in logs and error messages, e.g. "script". */
  label: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Give Claude the hosted web-search tool for this call. */
  webSearch?: boolean;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/**
 * Thin wrapper over the Messages API. Every call streams — generation steps
 * here routinely run for minutes and ask for tens of thousands of tokens, and
 * a non-streaming request that size risks an HTTP timeout.
 */
export class ClaudeClient {
  private readonly client: Anthropic;
  private readonly usage: UsageTotals = { inputTokens: 0, outputTokens: 0, calls: 0 };

  constructor(private readonly cfg: Config) {
    this.client = new Anthropic({ apiKey: cfg.ANTHROPIC_API_KEY, maxRetries: 2 });
  }

  get totals(): UsageTotals {
    return { ...this.usage };
  }

  async completeText(opts: CompleteOptions): Promise<string> {
    const started = Date.now();

    const tools: Anthropic.ToolUnion[] = opts.webSearch
      ? [{ type: 'web_search_20260209', name: 'web_search', max_uses: this.cfg.WEB_SEARCH_MAX_USES }]
      : [];

    const message = await withTimeout(
      this.client.messages
        .stream({
          model: this.cfg.AI_MODEL,
          max_tokens: opts.maxTokens ?? this.cfg.AI_MAX_TOKENS,
          system: opts.system,
          messages: [{ role: 'user', content: opts.prompt }],
          thinking: { type: 'adaptive' },
          output_config: { effort: this.cfg.AI_EFFORT },
          ...(tools.length > 0 ? { tools } : {}),
        })
        .finalMessage(),
      this.cfg.AI_TIMEOUT_MS,
      `${opts.label} generation`,
    );

    this.usage.calls += 1;
    this.usage.inputTokens += message.usage.input_tokens ?? 0;
    this.usage.outputTokens += message.usage.output_tokens ?? 0;

    if (message.stop_reason === 'refusal') {
      throw new Error(
        `Claude declined the "${opts.label}" request${
          message.stop_details && 'category' in message.stop_details ? ` (${message.stop_details.category})` : ''
        }. Try a different topic or rephrase the niche.`,
      );
    }

    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();

    log.info(
      {
        step: opts.label,
        ms: Date.now() - started,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        stop: message.stop_reason,
      },
      'generated',
    );

    if (message.stop_reason === 'max_tokens') {
      log.warn({ step: opts.label }, 'hit max_tokens — output may be truncated, consider raising AI_MAX_TOKENS');
    }
    if (!text) throw new Error(`Claude returned no text for "${opts.label}".`);
    return text;
  }

  /**
   * Asks for JSON and validates it. One repair round-trip is allowed: models
   * occasionally trail a stray comma, and re-asking is far cheaper than losing
   * the whole run.
   */
  async completeJson<S extends z.ZodTypeAny>(opts: CompleteOptions, schema: S): Promise<z.infer<S>> {
    const jsonSystem = `${opts.system}\n\n${JSON_RULES}`;
    const first = await this.completeText({ ...opts, system: jsonSystem });

    try {
      return schema.parse(extractJson(first));
    } catch (error) {
      log.warn({ step: opts.label, err: errorMessage(error) }, 'malformed JSON — asking Claude to repair it');
      const repaired = await this.completeText({
        ...opts,
        system: jsonSystem,
        prompt: `${opts.prompt}\n\n---\nYour previous answer could not be used:\n${errorMessage(error)}\n\nPrevious answer:\n${first.slice(0, 6000)}\n\nReturn the corrected JSON object only.`,
      });
      return schema.parse(extractJson(repaired));
    }
  }
}

const JSON_RULES = `OUTPUT FORMAT
Respond with a single JSON object and nothing else. No prose before or after it,
no markdown code fences, no trailing commas. Every string must be valid JSON —
escape any quotes or newlines inside string values.`;

/**
 * Tolerates the model wrapping its JSON in prose or a markdown fence, which
 * still happens occasionally even with an explicit instruction not to.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1]?.trim() ?? text;

  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`response contained no JSON object: ${body.slice(0, 200)}`);
  }
  return JSON.parse(body.slice(start, end + 1));
}

/** Rough spend estimate so a run does not surprise anyone. Opus 5 list price. */
export function estimateCostUsd(totals: UsageTotals): number {
  return (totals.inputTokens / 1_000_000) * 5 + (totals.outputTokens / 1_000_000) * 25;
}
