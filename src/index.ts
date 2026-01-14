#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { readDeckTool, handleReadDeck } from './tools/readDeck.js';
import { enrichCardsTool, handleEnrichCards } from './tools/enrichCards.js';
import { syncToAnkiTool, handleSyncToAnki } from './tools/syncToAnki.js';
import { listDecksTool, handleListDecks } from './tools/listDecks.js';
import { getCardsFromDeckTool, handleGetCardsFromDeck } from './tools/getCardsFromDeck.js';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.error('Warning: GEMINI_API_KEY environment variable is not set');
  console.error('Card enrichment will not work without it.');
}

// Create MCP server
const server = new Server(
  {
    name: 'anki-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [readDeckTool, enrichCardsTool, syncToAnkiTool, listDecksTool, getCardsFromDeckTool],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'read_deck': {
        const result = await handleReadDeck(args as { filePath: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'enrich_cards': {
        if (!GEMINI_API_KEY) {
          throw new Error('GEMINI_API_KEY environment variable is not set');
        }
        const result = await handleEnrichCards(
          args as { cards: Array<{ front: string; back: string }> },
          GEMINI_API_KEY
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'sync_to_anki': {
        const syncArgs = args as {
          deckName: string;
          cards: Array<{
            front: string;
            back: string;
            lösung?: string;
            erklärung?: string;
            eselsbrücke?: string;
            referenz?: string;
          }>;
          tags?: string[];
        };
        // Convert to EnrichedCard format (ensuring required fields)
        const enrichedCards = syncArgs.cards.map(card => ({
          front: card.front,
          back: card.back,
          lösung: card.lösung || '',
          erklärung: card.erklärung || '',
          eselsbrücke: card.eselsbrücke || '',
          referenz: card.referenz || '',
        }));
        const result = await handleSyncToAnki({
          deckName: syncArgs.deckName,
          cards: enrichedCards,
          tags: syncArgs.tags,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'list_anki_decks': {
        const result = await handleListDecks();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case 'get_cards_from_deck': {
        const result = await handleGetCardsFromDeck(args as { deckName: string });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Anki MCP Server (Adalbert) is running...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
