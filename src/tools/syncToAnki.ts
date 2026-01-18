import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { addNotes, checkAnkiConnect } from '../utils/ankiConnect.js';
import { EnrichedCard } from '../types/index.js';

export const syncToAnkiTool: Tool = {
  name: 'sync_to_anki',
  description: 'Sync enriched cards to Anki Desktop via AnkiConnect. Creates the deck if it doesn\'t exist.',
  inputSchema: {
    type: 'object',
    properties: {
      deckName: {
        type: 'string',
        description: 'Name of the deck to add cards to',
      },
      cards: {
        type: 'array',
        description: 'Array of enriched cards to add',
        items: {
          type: 'object',
          properties: {
            front: { type: 'string' },
            back: { type: 'string' },
            lösung: { type: 'string' },
            erklärung: { type: 'string' },
            eselsbrücke: { type: 'string' },
            referenz: { type: 'string' },
            extra1: { type: 'string' },
          },
          required: ['front', 'back'],
        },
      },
      tags: {
        type: 'array',
        description: 'Optional tags to add to all cards',
        items: { type: 'string' },
      },
    },
    required: ['deckName', 'cards'],
  },
};

export async function handleSyncToAnki(args: {
  deckName: string;
  cards: EnrichedCard[];
  tags?: string[];
}): Promise<{ success: boolean; noteIds: number[]; message: string }> {
  // Check if AnkiConnect is available
  const isAvailable = await checkAnkiConnect();
  if (!isAvailable) {
    throw new Error(
      'AnkiConnect is not available. Make sure:\n' +
      '1. Anki Desktop is running\n' +
      '2. AnkiConnect add-on is installed (code: 2055492159)'
    );
  }
  
  const { noteIds, skippedDuplicates } = await addNotes(
    args.deckName,
    args.cards.map(card => ({
      front: card.front,
      back: card.back, // Back bleibt für die Lösung
      originalAntwort: card.back, // Original-Antwort wird in separatem Feld gespeichert
      lösung: card.lösung,
      erklärung: card.erklärung,
      eselsbrücke: card.eselsbrücke,
      referenz: card.referenz,
      extra1: card.extra1 || '',
      tags: args.tags || [],
    }))
  );
  
  return {
    success: true,
    noteIds,
    message:
      `Successfully added ${noteIds.length} cards to deck "${args.deckName}".` +
      (skippedDuplicates > 0 ? ` Skipped ${skippedDuplicates} duplicates.` : ''),
  };
}
