import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { enrichCards } from '../utils/geminiEnricher.js';
import { EnrichedCard } from '../types/index.js';

export const enrichCardsTool: Tool = {
  name: 'enrich_cards',
  description: 'Enrich Anki cards with AI-generated German explanations and memory aids using a configurable LLM provider.',
  inputSchema: {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        description: 'Array of cards to enrich, each with front (question) and back (answer), optionally with options and answers',
        items: {
          type: 'object',
          properties: {
            front: { type: 'string' },
            back: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            answers: { type: 'string' },
          },
          required: ['front', 'back'],
        },
      },
      provider: {
        type: 'string',
        description: 'LLM provider (gemini, openai, together, openai-compatible). Defaults to LLM_PROVIDER env or gemini.',
      },
      model: {
        type: 'string',
        description: 'Model name override for the selected provider.',
      },
      apiKey: {
        type: 'string',
        description: 'BYOK override. If omitted, uses provider-specific env vars.',
      },
      baseUrl: {
        type: 'string',
        description: 'OpenAI-compatible base URL override (e.g., https://api.together.xyz).',
      },
      fallbackProviders: {
        type: 'array',
        items: { type: 'string' },
        description: 'Fallback providers to try when the primary provider is rate-limited.',
      },
      requestDelayMs: {
        type: 'number',
        description: 'Optional delay between requests in milliseconds.',
      },
    },
    required: ['cards'],
  },
};

export async function handleEnrichCards(
  args: {
    cards: Array<{ front: string; back: string; options?: string[]; answers?: string }>;
    provider?: string;
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    fallbackProviders?: string[];
    requestDelayMs?: number;
  }
): Promise<EnrichedCard[]> {
  if (args.cards.length === 0) {
    return [];
  }
  
  const enriched = await enrichCards(args.cards, {
    provider: args.provider,
    model: args.model,
    apiKey: args.apiKey,
    baseUrl: args.baseUrl,
    fallbackProviders: args.fallbackProviders,
    requestDelayMs: args.requestDelayMs,
  }, (current, total) => {
    // Progress could be logged here if needed
    console.log(`Enriching card ${current}/${total}...`);
  });
  
  return enriched;
}
