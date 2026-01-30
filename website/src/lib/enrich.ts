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
  originalAnswers?: string;  // Original-Antwortcode (z.B. "10110")
  lösung: string;
  erklärung: string;
  bewertungsTabelle?: Array<{  // Strukturierte Tabelle für MC-Fragen
    aussage: string;
    bewertung: 'Richtig' | 'Falsch' | 'Yes' | 'No';
    begründung: string;
  }>;
  zusammenfassung?: string;  // Kurze Zusammenfassung am Ende
  eselsbrücke: string;
  referenz: string;
  extra1?: string;
}

interface BewertungsEintrag {
  aussage?: string;
  option?: string;
  bewertung?: string;
  richtig?: boolean;
  begründung?: string;
  begruendung?: string;
  grund?: string;
}

interface GeminiResponse {
  lösung?: string;
  loesung?: string;
  antwort?: string;
  erklärung?: string;
  erklarung?: string;
  bewertungsTabelle?: BewertungsEintrag[];
  bewertungstabelle?: BewertungsEintrag[];
  tabelle?: BewertungsEintrag[];
  zusammenfassung?: string;
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

function sanitizeForPrompt(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeBewertung(value: string | boolean | undefined): 'Richtig' | 'Falsch' | 'Yes' | 'No' {
  if (typeof value === 'boolean') return value ? 'Richtig' : 'Falsch';
  const v = (value || '').toLowerCase().trim();
  if (v === 'yes' || v === 'ja' || v === 'richtig' || v === 'true' || v === '1') return 'Richtig';
  return 'Falsch';
}

function normalizeGeminiResponse(parsed: GeminiResponse, fallbackBack: string) {
  // Parse bewertungsTabelle
  const rawTabelle = parsed.bewertungsTabelle || parsed.bewertungstabelle || parsed.tabelle;
  let bewertungsTabelle: Array<{ aussage: string; bewertung: 'Richtig' | 'Falsch' | 'Yes' | 'No'; begründung: string }> | undefined;
  
  if (Array.isArray(rawTabelle) && rawTabelle.length > 0) {
    bewertungsTabelle = rawTabelle
      .filter((entry): entry is BewertungsEintrag => typeof entry === 'object' && entry !== null)
      .map((entry) => ({
        aussage: normalizeText(entry.aussage || entry.option),
        bewertung: normalizeBewertung(entry.bewertung ?? entry.richtig),
        begründung: normalizeText(entry.begründung || entry.begruendung || entry.grund),
      }))
      .filter((entry) => entry.aussage);
  }

  return {
    lösung: normalizeText(parsed.lösung || parsed.loesung || parsed.antwort) || normalizeText(fallbackBack),
    erklärung: normalizeText(parsed.erklärung || parsed.erklarung),
    bewertungsTabelle,
    zusammenfassung: normalizeText(parsed.zusammenfassung),
    eselsbrücke: normalizeText(parsed.eselsbrücke || parsed.eselsbrucke),
    referenz: normalizeText(parsed.referenz),
    extra1: normalizeText(parsed.extra1 || parsed['Extra 1']),
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
  const cleanFront = sanitizeForPrompt(front);
  const cleanBack = sanitizeForPrompt(back);
  const promptFront = cleanFront || front.trim();
  const optionsList = (options ?? []).map(opt => sanitizeForPrompt(opt));
  const hasOptions = optionsList.some((o) => o && o.trim().length > 0);
  let optionsText = '';
  if (hasOptions) {
    optionsText = '\n\nOPTIONEN:\n';
    optionsList.forEach((o, i) => {
      if (o && o.trim()) optionsText += `${i + 1}. ${o}\n`;
    });
  }

  const cleanedAnswers = answers ? sanitizeForPrompt(answers) : '';
  const explicitBinary = cleanedAnswers && isBinaryAnswerString(cleanedAnswers) ? cleanedAnswers : '';
  const fallbackBinary = !explicitBinary && isBinaryAnswerString(cleanBack) ? cleanBack : '';
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
    : cleanBack ? `\n\nANTWORT: ${cleanBack}` : '';

  const formatIntro = hasOptions
    ? hasBinary
      ? 'WICHTIG - Multiple-Choice mit Binärcode. Strukturierte Antwort mit Bewertungstabelle!'
      : 'WICHTIG - Multiple-Choice. Strukturierte Antwort mit Bewertungstabelle!'
    : 'WICHTIG - Keine Antwortoptionen. Antworte strukturiert und informativ.';

  const solutionInstructions = hasOptions
    ? '1. LÖSUNG: Kurze Einleitung zum klinischen Bild/Kontext, dann "Die korrekte Zuordnung lautet:..."'
    : '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Kurzantwort]."';

  const tableInstructions = hasOptions
    ? `2. BEWERTUNGSTABELLE: Für JEDE Option eine Zeile mit:
   - aussage: Die Option (gekürzt)
   - bewertung: "Richtig" oder "Falsch"
   - begründung: Warum richtig/falsch (medizinische Erklärung)`
    : '';

  const explanationInstructions = hasOptions
    ? '3. ZUSAMMENFASSUNG: 2-4 Sätze mit dem wichtigsten Take-Home-Message für die Praxis.'
    : '2. ERKLÄRUNG: Strukturiert mit Überblick und Begründung.';

  const solutionExample = hasOptions 
    ? 'Bei diesem klinischen Bild ist [Diagnose] anzunehmen. Die korrekte Zuordnung lautet:' 
    : 'Die richtige Antwort lautet: [Kurzantwort].';

  const jsonFormat = hasOptions
    ? `{
  "lösung": "${solutionExample}",
  "bewertungsTabelle": [
    { "aussage": "Option 1 (gekürzt)", "bewertung": "Richtig", "begründung": "Weil..." },
    { "aussage": "Option 2 (gekürzt)", "bewertung": "Falsch", "begründung": "Weil..." }
  ],
  "zusammenfassung": "Bei diesem Patienten muss sofort... Wichtig ist...",
  "eselsbrücke": "Eselsbrücke oder leer",
  "referenz": "Lehrbuch/Leitlinie",
  "extra1": "Klinischer Hinweis oder leer"
}`
    : `{
  "lösung": "${solutionExample}",
  "erklärung": "Überblick: ... | Warum korrekt: ...",
  "eselsbrücke": "Eselsbrücke oder leer",
  "referenz": "Lehrbuch/Leitlinie",
  "extra1": "Klinischer Hinweis oder leer"
}`;

  const prompt = `Du bist ein hilfreicher Tutor für Universitätsprüfungen (Medizin).
Ergänze die folgende Lernkarte mit einer klaren, STRUKTURIERTEN Erklärung auf Deutsch.

FRAGE: ${promptFront}${optionsText}${correctAnswersText}${answerText}

${formatIntro}

${solutionInstructions}
${tableInstructions}

${explanationInstructions}

ESELSBRÜCKE: Falls sinnvoll, maximal ein kurzer Satz. Sonst leer.

REFERENZ: Passende Quelle (Lehrbuch, Leitlinie, z.B. "AMBOSS", "Herold Innere Medizin").

EXTRA 1: Optional klinischer Hinweis, z.B. "Seit 2021 Teil des Neugeborenenscreenings in DE".

Antworte AUSSCHLIESSLICH im folgenden JSON-Format:
${jsonFormat}`;

  try {
    const text = await generateTextWithFallback(prompt, llmConfig);
    const parsed = parseGeminiResponse(text, back);
    const n = normalizeGeminiResponse(parsed, back);
    return { 
      front, 
      back: back || '', 
      originalAnswers: answers || (isBinaryAnswerString(back) ? back : undefined),
      ...n 
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    const lowered = msg.toLowerCase();
    const isRateLimit = lowered.includes('429') || lowered.includes('quota') || lowered.includes('rate limit');
    return {
      front,
      back: back || '',
      originalAnswers: answers || (isBinaryAnswerString(back) ? back : undefined),
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
    // Original-Daten übernehmen
    out.push({ 
      ...e, 
      options: c.options,
      originalAnswers: c.answers || e.originalAnswers,
    });
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
          originalAnswers: cards[j].answers,
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
