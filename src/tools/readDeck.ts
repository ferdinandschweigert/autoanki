import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { parseApkg } from '../utils/apkgParser.js';
import { AnkiDeck } from '../types/index.js';
import * as fs from 'fs';
import * as path from 'path';

export const readDeckTool: Tool = {
  name: 'read_deck',
  description: 'Read and parse an Anki .apkg file. Returns all cards with their questions and answers.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: {
        type: 'string',
        description: 'Path to the .apkg file (can be relative or absolute)',
      },
    },
    required: ['filePath'],
  },
};

export async function handleReadDeck(args: { filePath: string }): Promise<AnkiDeck> {
  let fullPath = args.filePath;
  
  // Expand ~ to home directory
  if (fullPath.startsWith('~')) {
    fullPath = path.join(process.env.HOME || '', fullPath.slice(1));
  }
  
  // Resolve relative paths
  if (!path.isAbsolute(fullPath)) {
    fullPath = path.resolve(process.cwd(), fullPath);
  }
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  
  if (!fullPath.endsWith('.apkg')) {
    throw new Error('File must be a .apkg file');
  }
  
  const deck = await parseApkg(fullPath);
  
  return deck;
}
