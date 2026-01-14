import AdmZip from 'adm-zip';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AnkiDeck } from '../types/index.js';

// Extended AnkiCard for .apkg files (includes metadata)
export interface AnkiCardFromApkg {
  front: string;
  back: string;
  noteId: number;
  tags: string[];
  noteType: string;
}

// Export AnkiDeck for backward compatibility
export type { AnkiDeck };

/**
 * Parse an .apkg file and extract all cards
 * .apkg files are ZIP archives containing SQLite databases
 */
export async function parseApkg(filePath: string): Promise<AnkiDeck> {
  // Create temp directory for extraction
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anki-mcp-'));
  
  try {
    // Extract ZIP
    const zip = new AdmZip(filePath);
    zip.extractAllTo(tempDir, true);
    
    // Find the collection.anki2 or similar database file
    const dbFile = fs.readdirSync(tempDir).find(f => 
      f.endsWith('.anki2') || f.endsWith('.db') || f === 'collection.anki2'
    );
    
    if (!dbFile) {
      throw new Error('No database file found in .apkg archive');
    }
    
    const dbPath = path.join(tempDir, dbFile);
    const db = new Database(dbPath, { readonly: true });
    
    try {
      // Get deck name from col table
      const deckInfo = db.prepare(`
        SELECT name FROM col LIMIT 1
      `).get() as { name: string } | undefined;
      
      const deckName = deckInfo?.name || path.basename(filePath, '.apkg');
      
      // Get all notes with their fields
      // Anki stores notes in 'notes' table and fields in 'flds' column (pipe-separated)
      const notes = db.prepare(`
        SELECT 
          n.id as noteId,
          n.mid as modelId,
          n.flds as fields,
          n.tags as tags,
          m.name as modelName,
          m.flds as fieldNames
        FROM notes n
        JOIN notetypes m ON n.mid = m.id
      `).all() as Array<{
        noteId: number;
        modelId: number;
        fields: string;
        tags: string;
        modelName: string;
        fieldNames: string;
      }>;
      
      const cards: AnkiCardFromApkg[] = [];
      
      for (const note of notes) {
        // Parse fields (pipe-separated, with \x1f as field separator in some versions)
        const fieldValues = note.fields.split('\x1f');
        const fieldNames = note.fieldNames.split('\x1f');
        
        // Find front and back fields (usually first two fields)
        let front = fieldValues[0] || '';
        let back = fieldValues[1] || '';
        
        // If we have named fields, try to find "Front" and "Back"
        const frontIndex = fieldNames.findIndex(f => 
          f.toLowerCase().includes('front') || f.toLowerCase().includes('frage')
        );
        const backIndex = fieldNames.findIndex(f => 
          f.toLowerCase().includes('back') || f.toLowerCase().includes('antwort')
        );
        
        if (frontIndex >= 0) front = fieldValues[frontIndex] || front;
        if (backIndex >= 0) back = fieldValues[backIndex] || back;
        
        // Parse tags (space-separated, with # prefix)
        const tags = note.tags
          ? note.tags.split(' ').filter(t => t.startsWith('#')).map(t => t.slice(1))
          : [];
        
        cards.push({
          front: front.trim(),
          back: back.trim(),
          noteId: note.noteId,
          tags,
          noteType: note.modelName,
        });
      }
      
      return {
        name: deckName,
        cards,
      };
    } finally {
      db.close();
    }
  } finally {
    // Cleanup temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
