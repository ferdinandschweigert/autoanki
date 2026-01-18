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

/**
 * Parse Gemini API response with fallback handling
 */
export function parseGeminiResponse(
  text: string,
  fallbackBack: string = ''
): GeminiResponse {
  try {
    const jsonText = extractJsonFromText(text);
    return JSON.parse(jsonText) as GeminiResponse;
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
    lösung: parsed.lösung || parsed.loesung || parsed.antwort || fallbackBack,
    erklärung: parsed.erklärung || parsed.erklarung || '',
    eselsbrücke: parsed.eselsbrücke || parsed.eselsbrucke || '',
    referenz: parsed.referenz || '',
    extra1: parsed.extra1 || parsed['Extra 1'] || '',
  };
}
