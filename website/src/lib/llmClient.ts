import { GoogleGenerativeAI } from '@google/generative-ai';

export type LlmProvider = 'gemini' | 'openai' | 'together' | 'openai-compatible';

export interface LlmProviderConfig {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LlmConfig {
  providers: LlmProviderConfig[];
  maxRetries: number;
  timeoutMs: number;
}

export interface LlmOverrides {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  fallbackProviders?: string[];
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  together: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
  'openai-compatible': 'gpt-4o-mini',
};

const DEFAULT_BASE_URLS: Partial<Record<LlmProvider, string>> = {
  openai: 'https://api.openai.com',
  together: 'https://api.together.xyz',
};

function parseProvider(value?: string): LlmProvider {
  if (!value) return 'gemini';
  const normalized = value.trim().toLowerCase();
  if (!normalized) return 'gemini';
  if (normalized === 'gemini' || normalized === 'google') return 'gemini';
  if (normalized === 'openai') return 'openai';
  if (normalized === 'together' || normalized === 'togetherai' || normalized === 'together-ai') {
    return 'together';
  }
  if (normalized === 'openai-compatible' || normalized === 'openai_compatible') {
    return 'openai-compatible';
  }
  throw new Error(`Unknown LLM provider: ${value}`);
}

function parseProviderList(value?: string): LlmProvider[] {
  if (!value) return [];
  const providers: LlmProvider[] = [];
  for (const part of value.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    providers.push(parseProvider(trimmed));
  }
  return Array.from(new Set(providers));
}

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveModel(provider: LlmProvider, override?: string): string {
  if (override) return override;
  const providerModel =
    provider === 'gemini'
      ? process.env.GEMINI_MODEL
      : provider === 'openai'
        ? process.env.OPENAI_MODEL
        : provider === 'together'
          ? process.env.TOGETHER_MODEL
          : undefined;
  return providerModel || process.env.LLM_MODEL || DEFAULT_MODELS[provider];
}

function resolveApiKey(provider: LlmProvider, override?: string): string | null {
  if (override) return override;
  const providerKey =
    provider === 'gemini'
      ? process.env.GEMINI_API_KEY
      : provider === 'openai'
        ? process.env.OPENAI_API_KEY
        : provider === 'together'
          ? process.env.TOGETHER_API_KEY
          : process.env.OPENAI_API_KEY;
  return providerKey || process.env.LLM_API_KEY || null;
}

function resolveBaseUrl(provider: LlmProvider, override?: string): string | undefined {
  if (provider === 'gemini') return undefined;
  const providerBase =
    provider === 'openai'
      ? process.env.OPENAI_BASE_URL
      : provider === 'together'
        ? process.env.TOGETHER_BASE_URL
        : undefined;
  const base = override || process.env.LLM_BASE_URL || providerBase || DEFAULT_BASE_URLS[provider];
  return base ? normalizeBaseUrl(base) : undefined;
}

function resolveProviderConfig(
  provider: LlmProvider,
  overrides: LlmOverrides | undefined,
  isPrimary: boolean
): LlmProviderConfig | null {
  const apiKey = resolveApiKey(provider, overrides?.apiKey);
  if (!apiKey) {
    if (isPrimary) {
      throw new Error(
        'No LLM API key configured. Set GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, or LLM_API_KEY.'
      );
    }
    return null;
  }
  const model = resolveModel(provider, overrides?.model);
  const baseUrl = resolveBaseUrl(provider, overrides?.baseUrl);
  if (provider === 'openai-compatible' && !baseUrl) {
    if (isPrimary) {
      throw new Error('LLM_BASE_URL (or baseUrl override) is required for provider "openai-compatible".');
    }
    return null;
  }
  return { provider, apiKey, model, baseUrl };
}

export function buildLlmConfig(overrides?: LlmOverrides): LlmConfig {
  const provider = parseProvider(overrides?.provider || process.env.LLM_PROVIDER);
  const fallbackProviders = overrides?.fallbackProviders
    ? overrides.fallbackProviders.map(parseProvider)
    : parseProviderList(process.env.LLM_FALLBACK_PROVIDERS);

  const maxRetries = getEnvNumber('LLM_MAX_RETRIES', 3);
  const timeoutMs = getEnvNumber('LLM_TIMEOUT_MS', 120000);

  const providers: LlmProviderConfig[] = [];
  const primary = resolveProviderConfig(provider, overrides, true);
  if (primary) providers.push(primary);

  for (const fallback of fallbackProviders) {
    if (fallback === provider) continue;
    const config = resolveProviderConfig(fallback, undefined, false);
    if (config) providers.push(config);
  }

  if (providers.length === 0) {
    throw new Error(
      'No LLM API key configured. Set GEMINI_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, or LLM_API_KEY.'
    );
  }

  return { providers, maxRetries, timeoutMs };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const status = (error as { status?: number }).status;
  return typeof status === 'number' ? status : undefined;
}

function isRateLimitError(error: unknown): boolean {
  const msg = getErrorMessage(error).toLowerCase();
  const status = getErrorStatus(error);
  return status === 429 || msg.includes('429') || msg.includes('rate limit') || msg.includes('quota');
}

function isAuthError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) return true;
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('api key');
}

function isRetryableError(error: unknown): boolean {
  const status = getErrorStatus(error);
  if (status && status >= 500) return true;
  const msg = getErrorMessage(error).toLowerCase();
  return msg.includes('timeout') || msg.includes('temporarily') || msg.includes('unavailable');
}

function shouldRetry(error: unknown): boolean {
  return isRateLimitError(error) || isRetryableError(error);
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateGemini(prompt: string, config: LlmProviderConfig): Promise<string> {
  const genAI = new GoogleGenerativeAI(config.apiKey);
  const model = genAI.getGenerativeModel({ model: config.model });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateOpenAICompatible(
  prompt: string,
  config: LlmProviderConfig,
  timeoutMs: number
): Promise<string> {
  const baseUrl = config.baseUrl;
  if (!baseUrl) {
    throw new Error('Missing baseUrl for openai-compatible provider');
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: controller.signal,
    });
    const payload = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        payload?.error?.message || payload?.error || payload?.message || res.statusText || 'Request failed';
      const err = new Error(`OpenAI-compatible error (${res.status}): ${message}`);
      (err as { status?: number }).status = res.status;
      throw err;
    }
    const text = payload?.choices?.[0]?.message?.content;
    if (!text || typeof text !== 'string') {
      throw new Error('Empty response from provider');
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      const err = new Error(`OpenAI-compatible request timed out after ${timeoutMs}ms`);
      (err as { status?: number }).status = 408;
      throw err;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function generateText(
  prompt: string,
  config: LlmProviderConfig,
  timeoutMs: number
): Promise<string> {
  if (config.provider === 'gemini') {
    return generateGemini(prompt, config);
  }
  return generateOpenAICompatible(prompt, config, timeoutMs);
}

async function generateTextWithRetry(
  prompt: string,
  config: LlmProviderConfig,
  maxRetries: number,
  timeoutMs: number
): Promise<string> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await generateText(prompt, config, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      const delayMs = 2000 * Math.pow(2, attempt);
      await sleep(delayMs);
      attempt += 1;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function generateTextWithFallback(prompt: string, config: LlmConfig): Promise<string> {
  const errors: string[] = [];
  for (const provider of config.providers) {
    try {
      return await generateTextWithRetry(prompt, provider, config.maxRetries, config.timeoutMs);
    } catch (error) {
      const message = getErrorMessage(error);
      errors.push(`${provider.provider}: ${message}`);
      if (!isRateLimitError(error) && !isRetryableError(error) && !isAuthError(error)) {
        break;
      }
    }
  }
  throw new Error(`All providers failed. ${errors.join(' | ')}`);
}
