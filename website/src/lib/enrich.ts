/**
 * Enrichment logic for Anki cards (mirrors src/utils/geminiEnricher + jsonUtils)
 */

import { buildLlmConfig, generateTextWithFallback, LlmConfig, LlmOverrides } from './llmClient';

export interface EnrichLlmOptions extends LlmOverrides {
  requestDelayMs?: number;
}

export interface EnrichedCard {
  front: string;
  back: string;
  options?: string[];  // MC-Optionen (Q_1 bis Q_5)
  lösung: string;
  erklärung: string;
  eselsbrücke: string;
  referenz: string;
  extra1?: string;
}

interface GeminiResponse {
  lösung?: string;
  loesung?: string;
  antwort?: string;
  erklärung?: string;
  erklarung?: string;
  eselsbrücke?: string;
  eselsbrucke?: string;
  referenz?: string;
  extra1?: string;
  'Extra 1'?: string;
}

function extractJsonFromText(text: string): string {
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/gm, '').replace(/```$/gm, '');
  }
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  return jsonMatch ? jsonMatch[0] : jsonText;
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

function parseGeminiResponse(text: string, fallbackBack: string): GeminiResponse {
  const jsonText = extractJsonFromText(text);
  try {
    return JSON.parse(jsonText) as GeminiResponse;
  } catch {
    const sanitized = sanitizeJsonString(jsonText);
    return JSON.parse(sanitized) as GeminiResponse;
  }
}

function normalizeGeminiResponse(parsed: GeminiResponse, fallbackBack: string) {
  return {
    lösung: parsed.lösung || parsed.loesung || parsed.antwort || fallbackBack,
    erklärung: parsed.erklärung || parsed.erklarung || '',
    eselsbrücke: parsed.eselsbrücke || parsed.eselsbrucke || '',
    referenz: parsed.referenz || '',
    extra1: parsed.extra1 || parsed['Extra 1'] || '',
  };
}

function isBinaryAnswerString(value: string): boolean {
  const t = value.trim();
  return t.length > 0 && /^[01\s,;|]+$/.test(t);
}

function parseAnswerBits(value: string): string[] {
  const tokens = value.trim().split(/[^01]+/).filter(Boolean);
  const bits: string[] = [];
  for (const token of tokens) {
    for (const c of token) {
      if (c === '0' || c === '1') bits.push(c);
    }
  }
  return bits;
}

function resolveRequestDelayMs(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override)) {
    return Math.max(0, override);
  }
  const raw = process.env.LLM_REQUEST_DELAY_MS;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(0, parsed);
    }
  }
  return 15000;
}

export async function enrichCard(
  front: string,
  back: string,
  llmConfig: LlmConfig,
  options?: string[],
  answers?: string
): Promise<EnrichedCard> {
  const optionsList = options ?? [];
  const hasOptions = optionsList.some((o) => o && o.trim().length > 0);
  let optionsText = '';
  if (hasOptions) {
    optionsText = '\n\nOPTIONEN:\n';
    optionsList.forEach((o, i) => {
      if (o && o.trim()) optionsText += `${i + 1}. ${o}\n`;
    });
  }

  const explicitBinary = answers && isBinaryAnswerString(answers) ? answers : '';
  const fallbackBinary = !explicitBinary && isBinaryAnswerString(back) ? back : '';
  const binaryAnswers = explicitBinary || fallbackBinary;
  let correctAnswersText = '';
  if (hasOptions && binaryAnswers) {
    const bits = parseAnswerBits(binaryAnswers);
    const correct: string[] = [];
    const incorrect: string[] = [];
    bits.forEach((b, i) => {
      if (optionsList[i]) {
        if (b === '1') correct.push(`${i + 1}. ${optionsList[i]}`);
        else incorrect.push(`${i + 1}. ${optionsList[i]}`);
      }
    });
    if (correct.length) correctAnswersText = `\n\nRICHTIGE ANTWORTEN (laut Binärcode):\n${correct.join('\n')}`;
    if (incorrect.length) correctAnswersText += `\n\nFALSCHE ANTWORTEN:\n${incorrect.join('\n')}`;
  }

  const hasBinary = hasOptions && binaryAnswers;
  const answerText = hasBinary
    ? `\n\nANTWORT (Binärcode): ${binaryAnswers}`
    : back.trim() ? `\n\nANTWORT: ${back.trim()}` : '';

  const formatIntro = hasOptions
    ? hasBinary
      ? 'WICHTIG - Multiple-Choice mit Binärcode. Antworte sehr kurz, strukturiert und extrem informativ.'
      : 'WICHTIG - Multiple-Choice. Antworte sehr kurz, strukturiert und extrem informativ.'
    : 'WICHTIG - Keine Antwortoptionen. Antworte sehr kurz, strukturiert und extrem informativ.';

  const solutionInstructions = hasOptions
    ? hasBinary
      ? '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Liste]." (aus dem Binärcode)'
      : '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Liste]."'
    : '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Kurzantwort]."';

  const explanationInstructions = hasOptions
    ? '2. ERKLÄRUNG: Max. 3 sehr kurze Zeilen mit Labels:\n   Überblick: ...\n   Richtig: Option X – Grund; Option Y – Grund\n   Falsch: Option Z – Grund'
    : '2. ERKLÄRUNG: Max. 2 sehr kurze Zeilen mit Labels:\n   Überblick: ...\n   Warum korrekt: ...';

  const solutionExample = hasOptions ? 'Die richtige Antwort lautet: [Liste der richtigen Optionen].' : 'Die richtige Antwort lautet: [Kurzantwort].';
  const explanationExample = hasOptions
    ? 'Überblick: ... | Richtig: ... | Falsch: ...'
    : 'Überblick: ... | Warum korrekt: ...';

  const prompt = `Du bist ein hilfreicher Tutor für Universitätsprüfungen.
Ergänze die folgende Lernkarte mit einer klaren, strukturierten Erklärung auf Deutsch.

FRAGE: ${front}${optionsText}${correctAnswersText}${answerText}

${formatIntro}

${solutionInstructions}

${explanationInstructions}

3. ESELSBRÜCKE: Falls sinnvoll, maximal ein kurzer Satz. Sonst leer.

4. REFERENZ: Gib eine passende Referenz an, z.B. ein Standardlehrbuch oder eine Leitlinie.

5. EXTRA 1: Optional, maximal ein kurzer Satz (z.B. klinischer Hinweis). Sonst leer.

Antworte im folgenden JSON-Format:
{
  "lösung": "${solutionExample}",
  "erklärung": "${explanationExample}",
  "eselsbrücke": "Eselsbrücke hier oder leer lassen wenn nicht sinnvoll",
  "referenz": "Passende Quelle/Lehrbuch/Leitlinie",
  "extra1": "Zusätzliche Informationen oder leer lassen"
}`;

  try {
    const text = await generateTextWithFallback(prompt, llmConfig);
    const parsed = parseGeminiResponse(text, back);
    const n = normalizeGeminiResponse(parsed, back);
    return { front, back: back || '', ...n };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const lowered = msg.toLowerCase();
    const isRateLimit = lowered.includes('429') || lowered.includes('quota') || lowered.includes('rate limit');
    return {
      front,
      back: back || '',
      lösung: back || '',
      erklärung: isRateLimit
        ? '⚠️ Rate limit/Quota erreicht. Bitte später erneut versuchen oder einen anderen Provider/Key nutzen.'
        : `Fehler bei der Generierung: ${msg}`,
      eselsbrücke: '',
      referenz: '',
      extra1: '',
    };
  }
}

function isRateLimitMessage(text: string): boolean {
  const lowered = text.toLowerCase();
  return lowered.includes('rate limit') || lowered.includes('quota') || lowered.includes('429');
}

/** Enrich multiple cards with rate limiting */
export async function enrichCards(
  cards: Array<{ front: string; back: string; options?: string[]; answers?: string }>,
  llmOptions?: EnrichLlmOptions,
  onProgress?: (current: number, total: number) => void
): Promise<EnrichedCard[]> {
  const out: EnrichedCard[] = [];
  const llmConfig = buildLlmConfig(llmOptions);
  const delayMs = resolveRequestDelayMs(llmOptions?.requestDelayMs);

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const e = await enrichCard(c.front, c.back, llmConfig, c.options, c.answers);
    // Optionen mit übernehmen
    out.push({ ...e, options: c.options });
    onProgress?.(i + 1, cards.length);
    
    // Bei Rate-Limit/Quota optional stoppen
    if (isRateLimitMessage(e.erklärung)) {
      console.warn('Rate limit/Quota erreicht, stoppe weitere Anreicherung');
      // Restliche Karten mit Fehlermeldung hinzufügen
      for (let j = i + 1; j < cards.length; j++) {
        out.push({
          front: cards[j].front,
          back: cards[j].back || '',
          options: cards[j].options,
          lösung: cards[j].back || '',
          erklärung: '⚠️ Anreicherung gestoppt: Rate limit/Quota erreicht.',
          eselsbrücke: '',
          referenz: '',
          extra1: '',
        });
      }
      break;
    }
    
    if (i < cards.length - 1) {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  return out;
}
