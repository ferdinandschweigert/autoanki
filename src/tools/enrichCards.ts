import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { enrichCards } from '../utils/geminiEnricher.js';
import { EnrichedCard } from '../types/index.js';

export const enrichCardsTool: Tool = {
  name: 'enrich_cards',
  description: 'Enrich Anki cards with AI-generated German explanations and memory aids using Gemini API.',
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
    },
    required: ['cards'],
  },
};

export async function handleEnrichCards(
  args: { cards: Array<{ front: string; back: string; options?: string[]; answers?: string }> },
  apiKey: string
): Promise<EnrichedCard[]> {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }
  
  if (args.cards.length === 0) {
    return [];
  }
  
  const enriched = await enrichCards(args.cards, apiKey, (current, total) => {
    // Progress could be logged here if needed
    console.log(`Enriching card ${current}/${total}...`);
  });
  
  return enriched;
}
