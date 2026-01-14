import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getCardsFromDeck, checkAnkiConnect } from '../utils/ankiConnect.js';
import { AnkiCardFromDeck } from '../types/index.js';

export const getCardsFromDeckTool: Tool = {
  name: 'get_cards_from_deck',
  description: 'Read all cards from an existing Anki deck. Returns cards with their questions and answers.',
  inputSchema: {
    type: 'object',
    properties: {
      deckName: {
        type: 'string',
        description: 'Name of the deck to read cards from (exact name as it appears in Anki)',
      },
    },
    required: ['deckName'],
  },
};

export async function handleGetCardsFromDeck(args: { deckName: string }): Promise<{ cards: AnkiCardFromDeck[]; count: number }> {
  const isAvailable = await checkAnkiConnect();
  if (!isAvailable) {
    throw new Error(
      'AnkiConnect is not available. Make sure:\n' +
      '1. Anki Desktop is running\n' +
      '2. AnkiConnect add-on is installed (code: 2055492159)'
    );
  }
  
  const cards = await getCardsFromDeck(args.deckName);
  
  return {
    cards,
    count: cards.length,
  };
}
