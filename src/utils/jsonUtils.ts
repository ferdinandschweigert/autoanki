/**
 * JSON parsing and extraction utilities
 */

import { GeminiResponse } from '../types/index.js';

/**
 * Extract JSON from text that may contain markdown code blocks or other formatting
 */
export function extractJsonFromText(text: string): string {
  let jsonText = text.trim();
  
  // Remove markdown code blocks if present
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/gm, '').replace(/```$/gm, '');
  }
  
  // Try to find JSON object in the text
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }
  
  return jsonText;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function sanitizeJsonString(jsonText: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonText.length; i++) {
    const ch = jsonText[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      const code = ch.charCodeAt(0);
      if (code < 0x20) {
        if (ch === '\n') out += '\\n';
        else if (ch === '\r') out += '\\r';
        else if (ch === '\t') out += '\\t';
        else out += '';
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Parse Gemini API response with fallback handling
 */
export function parseGeminiResponse(
  text: string,
  fallbackBack: string = ''
): GeminiResponse {
  try {
    const jsonText = extractJsonFromText(text);
    try {
      return JSON.parse(jsonText) as GeminiResponse;
    } catch (error) {
      const sanitized = sanitizeJsonString(jsonText);
      return JSON.parse(sanitized) as GeminiResponse;
    }
  } catch (error: any) {
    console.error(`JSON parsing error: ${error.message}`);
    console.error(`Response text (first 500 chars): ${text.substring(0, 500)}`);
    throw new Error(`Failed to parse JSON response: ${error.message}`);
  }
}

/**
 * Normalize Gemini response field names (handle alternative spellings)
 */
export function normalizeGeminiResponse(parsed: GeminiResponse, fallbackBack: string = ''): {
  lösung: string;
  erklärung: string;
  eselsbrücke: string;
  referenz: string;
  extra1: string;
} {
  return {
    lösung: normalizeText(parsed.lösung || parsed.loesung || parsed.antwort) || normalizeText(fallbackBack),
    erklärung: normalizeText(parsed.erklärung || parsed.erklarung),
    eselsbrücke: normalizeText(parsed.eselsbrücke || parsed.eselsbrucke),
    referenz: normalizeText(parsed.referenz),
    extra1: normalizeText(parsed.extra1 || parsed['Extra 1']),
  };
}
