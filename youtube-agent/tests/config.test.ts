import { describe, expect, it } from 'vitest';
import { loadConfig, redactConfig } from '../src/config.js';

const base = { ANTHROPIC_API_KEY: 'sk-ant-test-key-value' } as NodeJS.ProcessEnv;

describe('loadConfig', () => {
  it('needs an Anthropic key', () => {
    expect(() => loadConfig({})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('applies defaults for everything else', () => {
    const cfg = loadConfig(base);
    expect(cfg.AI_MODEL).toBe('claude-opus-5');
    expect(cfg.AI_EFFORT).toBe('high');
    expect(cfg.CONTENT_LANGUAGE).toBe('en');
    expect(cfg.TARGET_DURATION_SEC).toBe(480);
    expect(cfg.TTS_PROVIDER).toBe('none');
    expect(cfg.ENABLE_WEB_SEARCH).toBe(false);
  });

  it('parses booleans the way a human writes them', () => {
    expect(loadConfig({ ...base, ENABLE_WEB_SEARCH: 'yes' }).ENABLE_WEB_SEARCH).toBe(true);
    expect(loadConfig({ ...base, ENABLE_WEB_SEARCH: 'FALSE' }).ENABLE_WEB_SEARCH).toBe(false);
    expect(loadConfig({ ...base, LOG_PRETTY: '0' }).LOG_PRETTY).toBe(false);
  });

  it('rejects a non-numeric duration instead of producing NaN', () => {
    expect(() => loadConfig({ ...base, TARGET_DURATION_SEC: 'ten minutes' })).toThrow(/TARGET_DURATION_SEC/);
  });

  it('rejects a duration outside the supported range', () => {
    expect(() => loadConfig({ ...base, TARGET_DURATION_SEC: '5' })).toThrow(/TARGET_DURATION_SEC/);
  });

  it('rejects an unknown effort level', () => {
    expect(() => loadConfig({ ...base, AI_EFFORT: 'turbo' })).toThrow(/AI_EFFORT/);
  });

  it('refuses elevenlabs TTS without its key', () => {
    expect(() => loadConfig({ ...base, TTS_PROVIDER: 'elevenlabs' })).toThrow(/ELEVENLABS_API_KEY/);
  });

  it('accepts elevenlabs TTS once the key is present', () => {
    const cfg = loadConfig({ ...base, TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'el-key' });
    expect(cfg.TTS_PROVIDER).toBe('elevenlabs');
  });
});

describe('redactConfig', () => {
  it('never leaks a full key', () => {
    const redacted = redactConfig(loadConfig({ ...base, PEXELS_API_KEY: 'pexels-secret-value' }));
    expect(JSON.stringify(redacted)).not.toContain('sk-ant-test-key-value');
    expect(JSON.stringify(redacted)).not.toContain('pexels-secret-value');
    expect(redacted.YOUTUBE_API_KEY).toBe('unset');
  });
});
