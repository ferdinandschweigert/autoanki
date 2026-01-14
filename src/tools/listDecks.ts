import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { listDecks, checkAnkiConnect } from '../utils/ankiConnect.js';

export const listDecksTool: Tool = {
  name: 'list_anki_decks',
  description: 'List all decks in Anki Desktop. Requires AnkiConnect to be running.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
};

export async function handleListDecks(): Promise<{ decks: string[] }> {
  const isAvailable = await checkAnkiConnect();
  if (!isAvailable) {
    throw new Error(
      'AnkiConnect is not available. Make sure:\n' +
      '1. Anki Desktop is running\n' +
      '2. AnkiConnect add-on is installed (code: 2055492159)'
    );
  }
  
  const decks = await listDecks();
  return { decks };
}
