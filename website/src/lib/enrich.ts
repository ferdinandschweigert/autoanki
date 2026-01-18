/**
 * Enrichment logic for Anki cards (mirrors src/utils/geminiEnricher + jsonUtils)
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

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

function parseGeminiResponse(text: string, fallbackBack: string): GeminiResponse {
  const jsonText = extractJsonFromText(text);
  return JSON.parse(jsonText) as GeminiResponse;
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

export async function enrichCard(
  front: string,
  back: string,
  apiKey: string,
  options?: string[],
  answers?: string
): Promise<EnrichedCard> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

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
      ? 'WICHTIG - Dies ist eine Multiple-Choice Frage mit den oben genannten Optionen und dem angegebenen Binärcode! Bitte erstelle die Erklärung im folgenden EXAKTEN Format:'
      : 'WICHTIG - Dies ist eine Multiple-Choice Frage mit den oben genannten Optionen! Bitte bestimme die richtigen Antworten und erstelle die Erklärung im folgenden EXAKTEN Format:'
    : 'WICHTIG - Dies ist eine Lernkarte ohne Antwortoptionen. Bitte erstelle die Erklärung im folgenden EXAKTEN Format:';

  const solutionInstructions = hasOptions
    ? hasBinary
      ? '1. LÖSUNG: Beginne mit "Die richtige Antwort lautet: [Liste der richtigen Optionen]."\n   - Verwende die oben angegebenen richtigen Antworten aus dem Binärcode\n   - Falls die Frage nach "trifft nicht zu" fragt, identifiziere welche Aussage NICHT zutrifft'
      : '1. LÖSUNG: Beginne mit "Die richtige Antwort lautet: [Liste der richtigen Optionen]."\n   - Bestimme die richtigen Optionen aus dem Inhalt der Frage\n   - Falls die Frage nach "trifft nicht zu" fragt, identifiziere welche Aussage NICHT zutrifft'
    : '1. LÖSUNG: Beginne mit "Die richtige Antwort lautet: [Kurzantwort]."\n   - Antworte kurz und präzise';

  const explanationInstructions = hasOptions
    ? '2. ERKLÄRUNG: Strukturiere die Erklärung wie folgt:\n   a) Zuerst eine allgemeine Einführung zum Konzept/Erkrankung (2-3 Sätze)\n   b) Dann "Erläuterung der richtigen Antwort(en):" - erkläre detailliert warum jede richtige Option richtig ist\n   c) Dann "Warum die anderen Optionen nicht korrekt sind:" - erkläre für jede falsche Option warum sie falsch ist'
    : '2. ERKLÄRUNG: Strukturiere die Erklärung wie folgt:\n   a) Zuerst eine allgemeine Einführung zum Konzept/Erkrankung (2-3 Sätze)\n   b) Dann "Erläuterung der Antwort:" - erkläre warum die Antwort korrekt ist (2-4 Sätze)';

  const solutionExample = hasOptions ? 'Die richtige Antwort lautet: [Liste der richtigen Optionen].' : 'Die richtige Antwort lautet: [Kurzantwort].';
  const explanationExample = hasOptions
    ? '[Allgemeine Einführung]. Erläuterung der richtigen Antwort(en): [...]. Warum die anderen Optionen nicht korrekt sind: [...].'
    : '[Allgemeine Einführung]. Erläuterung der Antwort: [...].';

  const prompt = `Du bist ein hilfreicher Tutor für Universitätsprüfungen.
Ergänze die folgende Lernkarte mit einer klaren, strukturierten Erklärung auf Deutsch.

FRAGE: ${front}${optionsText}${correctAnswersText}${answerText}

${formatIntro}

${solutionInstructions}

${explanationInstructions}

3. ESELSBRÜCKE: Eine Eselsbrücke (falls sinnvoll), die beim Merken hilft. Wenn keine gute Eselsbrücke möglich ist, lasse dieses Feld leer.

4. REFERENZ: Gib eine passende Referenz an, z.B. ein Standardlehrbuch oder eine Leitlinie.

5. EXTRA 1: Zusätzliche Informationen, die für das Verständnis hilfreich sein können (Klinische Relevanz, Differenzialdiagnosen, Praktische Tipps). Falls nicht nötig, leer lassen.

Antworte im folgenden JSON-Format:
{
  "lösung": "${solutionExample}",
  "erklärung": "${explanationExample}",
  "eselsbrücke": "Eselsbrücke hier oder leer lassen wenn nicht sinnvoll",
  "referenz": "Passende Quelle/Lehrbuch/Leitlinie",
  "extra1": "Zusätzliche Informationen oder leer lassen"
}`;

  try {
    const result = await model.generateContent(prompt);
    const text = (await result.response).text();
    const parsed = parseGeminiResponse(text, back);
    const n = normalizeGeminiResponse(parsed, back);
    return { front, back: back || '', ...n };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      front,
      back: back || '',
      lösung: back || '',
      erklärung: `Fehler bei der Generierung: ${msg}`,
      eselsbrücke: '',
      referenz: '',
      extra1: '',
    };
  }
}

/** Enrich multiple cards with rate limiting (free tier ~5/min → ~14s between cards) */
export async function enrichCards(
  cards: Array<{ front: string; back: string; options?: string[]; answers?: string }>,
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<EnrichedCard[]> {
  const out: EnrichedCard[] = [];
  const delayMs = 14000; // ~4/min to stay under 5/min

  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const e = await enrichCard(c.front, c.back, apiKey, c.options, c.answers);
    // Optionen mit übernehmen
    out.push({ ...e, options: c.options });
    onProgress?.(i + 1, cards.length);
    if (i < cards.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return out;
}
