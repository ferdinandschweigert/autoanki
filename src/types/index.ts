/**
 * Common types and interfaces for the Anki MCP Server
 */

/**
 * An enriched Anki card with AI-generated content
 */
export interface EnrichedCard {
  front: string;
  back: string;
  lösung: string;  // Die richtige Antwort/Lösung (ganz oben)
  erklärung: string;
  eselsbrücke: string;
  referenz: string;  // Quellenangabe (Lehrbuch/Leitlinie)
  extra1?: string;  // Extra 1 field for additional content
}

/**
 * Raw card from Anki deck (with all fields)
 */
export interface AnkiCardFromDeck {
  front: string;
  back: string;
  question: string;
  options: string[]; // Q_1, Q_2, Q_3, Q_4, Q_5
  answers: string; // Binary code like "1 1 0 1"
  qType: number; // 0=kprim, 1=mc, 2=sc
  noteId: number;
  tags: string[];
  noteType: string;
}

/**
 * Basic card structure (minimal)
 */
export interface AnkiCard {
  front: string;
  back: string;
}

/**
 * Deck structure
 */
export interface AnkiDeck {
  name: string;
  cards: Array<{ front: string; back: string }>;
}

/**
 * Gemini API response structure
 */
export interface GeminiResponse {
  lösung?: string;
  loesung?: string;  // Alternative spelling
  antwort?: string;
  erklärung?: string;
  erklarung?: string;  // Alternative spelling
  eselsbrücke?: string;
  eselsbrucke?: string;  // Alternative spelling
  referenz?: string;
  extra1?: string;
  'Extra 1'?: string;
}

/**
 * AnkiConnect request structure
 */
export interface AnkiConnectRequest {
  action: string;
  version: number;
  params?: any;
}

/**
 * AnkiConnect response structure
 */
export interface AnkiConnectResponse {
  result: any;
  error: string | null;
}
