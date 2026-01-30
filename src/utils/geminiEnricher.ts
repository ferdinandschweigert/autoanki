import { EnrichedCard } from '../types/index.js';
import { parseGeminiResponse, normalizeGeminiResponse } from './jsonUtils.js';
import { buildLlmConfig, generateTextWithFallback, LlmConfig, LlmOverrides } from './llmClient.js';

export interface EnrichLlmOptions extends LlmOverrides {
  requestDelayMs?: number;
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
  return 500;
}

function sanitizeForPrompt(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isBinaryAnswerString(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /^[01\s,;|]+$/.test(trimmed);
}

function parseAnswerBits(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const tokens = trimmed.split(/[^01]+/).filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }
  const bits: string[] = [];
  for (const token of tokens) {
    for (const char of token) {
      if (char === '0' || char === '1') {
        bits.push(char);
      }
    }
  }
  return bits;
}

/**
 * Enrich a single card with German explanations using an LLM API
 */
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

  // Build options list if available
  const optionsList = (options ?? []).map(opt => sanitizeForPrompt(opt));
  const hasOptions = optionsList.some(opt => opt && opt.trim().length > 0);
  let optionsText = '';
  if (hasOptions) {
    optionsText = '\n\nOPTIONEN:\n';
    optionsList.forEach((opt, idx) => {
      if (opt && opt.trim().length > 0) {
        optionsText += `${idx + 1}. ${opt}\n`;
      }
    });
  }
  
  // Parse binary answers if available
  const cleanedAnswers = answers ? sanitizeForPrompt(answers) : '';
  const explicitBinaryAnswers = cleanedAnswers && isBinaryAnswerString(cleanedAnswers) ? cleanedAnswers : '';
  const fallbackBinaryAnswers = !explicitBinaryAnswers && isBinaryAnswerString(cleanBack) ? cleanBack : '';
  const binaryAnswers = explicitBinaryAnswers || fallbackBinaryAnswers;
  let answerBits: string[] = [];
  let correctAnswersText = '';
  if (hasOptions && binaryAnswers) {
    answerBits = parseAnswerBits(binaryAnswers);
    const correctOptions: string[] = [];
    const incorrectOptions: string[] = [];
    
    answerBits.forEach((bit, idx) => {
      if (optionsList[idx]) {
        if (bit === '1') {
          correctOptions.push(`${idx + 1}. ${optionsList[idx]}`);
        } else {
          incorrectOptions.push(`${idx + 1}. ${optionsList[idx]}`);
        }
      }
    });
    
    if (correctOptions.length > 0) {
      correctAnswersText = `\n\nRICHTIGE ANTWORTEN (laut Binärcode):\n${correctOptions.join('\n')}`;
    }
    if (incorrectOptions.length > 0) {
      correctAnswersText += `\n\nFALSCHE ANTWORTEN:\n${incorrectOptions.join('\n')}`;
    }
  }
  
  const hasBinaryAnswers = hasOptions && answerBits.length > 0;
  const backText = cleanBack;
  const answerText = hasBinaryAnswers
    ? `\n\nANTWORT (Binärcode): ${binaryAnswers}`
    : backText
      ? `\n\nANTWORT: ${backText}`
      : '';
  const formatIntro = hasOptions
    ? hasBinaryAnswers
      ? 'WICHTIG - Multiple-Choice mit Binärcode. Antworte sehr kurz, strukturiert und extrem informativ.'
      : 'WICHTIG - Multiple-Choice. Antworte sehr kurz, strukturiert und extrem informativ.'
    : 'WICHTIG - Keine Antwortoptionen. Antworte sehr kurz, strukturiert und extrem informativ.';
  const solutionInstructions = hasOptions
    ? hasBinaryAnswers
      ? '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Liste]." (aus dem Binärcode)'
      : '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Liste]."'
    : '1. LÖSUNG: Eine Zeile: "Die richtige Antwort lautet: [Kurzantwort]."';
  const explanationInstructions = hasOptions
    ? '2. ERKLÄRUNG: Max. 3 sehr kurze Zeilen mit Labels:\n   Überblick: ...\n   Richtig: Option X – Grund; Option Y – Grund\n   Falsch: Option Z – Grund'
    : '2. ERKLÄRUNG: Max. 2 sehr kurze Zeilen mit Labels:\n   Überblick: ...\n   Warum korrekt: ...';
  const solutionExample = hasOptions
    ? 'Die richtige Antwort lautet: [Liste der richtigen Optionen].'
    : 'Die richtige Antwort lautet: [Kurzantwort].';
  const explanationExample = hasOptions
    ? 'Überblick: ... | Richtig: ... | Falsch: ...'
    : 'Überblick: ... | Warum korrekt: ...';

  const prompt = `Du bist ein hilfreicher Tutor für Universitätsprüfungen. 
Ergänze die folgende Lernkarte mit einer klaren, strukturierten Erklärung auf Deutsch.

FRAGE: ${promptFront}${optionsText}${correctAnswersText}${answerText}

${formatIntro}

${solutionInstructions}

${explanationInstructions}

3. ESELSBRÜCKE: Falls sinnvoll, maximal ein kurzer Satz. Sonst leer.

4. REFERENZ: Gib eine passende Referenz an, z.B. ein Standardlehrbuch oder eine Leitlinie. Beispiele:
   - "Duale Reihe Orthopädie, Kapitel [Thema]"
   - "AWMF-Leitlinie [Name]"
   - "Prometheus Lernatlas der Anatomie"
   - "Amboss - [Thema]"
   - "Herold Innere Medizin"

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
    
    // Parse and normalize the response
    const parsed = parseGeminiResponse(text, back);
    const normalized = normalizeGeminiResponse(parsed, back);
    
    return {
      front,
      back: back || '',
      ...normalized,
    };
  } catch (error: any) {
    console.error(`LLM API Error: ${error.message}`);
    
    // Fallback if API fails
    const fallbackText = error.message.includes('parse') 
      ? `Fehler bei der JSON-Verarbeitung: ${error.message}`
      : `Fehler bei der Generierung: ${error.message}`;
    
    return {
      front,
      back: back || '',
      lösung: back || '',
      erklärung: fallbackText,
      eselsbrücke: '',
      referenz: '',
      extra1: '',
    };
  }
}

/**
 * Enrich multiple cards (with rate limiting)
 */
export async function enrichCards(
  cards: Array<{ 
    front: string; 
    back: string; 
    options?: string[]; 
    answers?: string;
  }>,
  llmOptions?: EnrichLlmOptions,
  onProgress?: (current: number, total: number) => void
): Promise<EnrichedCard[]> {
  const enriched: EnrichedCard[] = [];
  const llmConfig = buildLlmConfig(llmOptions);
  const delayMs = resolveRequestDelayMs(llmOptions?.requestDelayMs);
  
  // Process cards with a small delay to respect rate limits
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    
    try {
      const enrichedCard = await enrichCard(
        card.front, 
        card.back, 
        llmConfig,
        card.options,
        card.answers
      );
      enriched.push(enrichedCard);
      
      if (onProgress) {
        onProgress(i + 1, cards.length);
      }
      
      // Small delay to avoid rate limits
      if (delayMs > 0 && i < cards.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    } catch (error: any) {
      console.error(`Error enriching card ${i + 1}:`, error);
      // Add card without enrichment if API fails
      enriched.push({
        front: card.front,
        back: card.back || '', // Behalte die bestehende Antwort bei
        lösung: card.back || '',
        erklärung: `Fehler bei der Generierung: ${error.message}`,
        eselsbrücke: '',
        referenz: '',
        extra1: '',
      });
    }
  }
  
  return enriched;
}
