import { buildLlmConfig, generateTextWithFallback, LlmConfig, LlmOverrides } from './llmClient';

export interface PriorityCardInput {
  id: string;
  front: string;
  options?: string[];
  tags?: string[];
}

export interface PrioritySuggestion {
  id: string;
  rank: number;
  front: string;
  topic: string;
  reason: string;
  learningGoals?: string[];  // Konkrete Lernziele für das Thema
  relatedCards?: number;     // Anzahl verwandter Karten im Deck
}

interface PriorityCandidate {
  id: string;
  rank?: number;
  topic?: string;
  reason?: string;
  learningGoals?: string[];
  relatedCards?: number;
}

export interface PriorityOptions extends LlmOverrides {
  topN?: number;
  chunkSize?: number;
}

const DEFAULT_TOP_N = 15;
const DEFAULT_CHUNK_SIZE = 80; // Größere Chunks für bessere Themen-Erkennung
const MAX_FRONT_LENGTH = 180;
const MAX_OPTION_LENGTH = 100;

const STOPWORDS = new Set([
  'der', 'die', 'das', 'und', 'oder', 'ein', 'eine', 'einer', 'eines', 'im', 'in', 'am', 'an', 'auf',
  'für', 'fur', 'mit', 'ohne', 'von', 'zu', 'zum', 'zur', 'des', 'den', 'dem', 'dass', 'ist', 'sind',
  'bei', 'als', 'auch', 'nicht', 'kein', 'keine', 'was', 'wie', 'welche', 'welcher', 'welches',
  'the', 'and', 'or', 'with', 'without', 'from', 'into', 'that', 'this', 'these', 'those',
]);

function extractJsonFromText(text: string): string {
  let jsonText = text.trim();
  if (jsonText.startsWith('```')) {
    jsonText = jsonText.replace(/^```(?:json)?\n?/gm, '').replace(/```$/gm, '');
  }
  const objectMatch = jsonText.match(/\{[\s\S]*\}/);
  if (objectMatch) return objectMatch[0];
  const arrayMatch = jsonText.match(/\[[\s\S]*\]/);
  return arrayMatch ? arrayMatch[0] : jsonText;
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

function safeJsonParse<T>(text: string): T | null {
  const jsonText = extractJsonFromText(text);
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    try {
      const sanitized = sanitizeJsonString(jsonText);
      return JSON.parse(sanitized) as T;
    } catch {
      return null;
    }
  }
}

function normalizeId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const id = String(value).trim();
  return id.length ? id : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 3))}...`;
}

function normalizeText(value: string): string {
  return normalizeWhitespace(stripHtml(value));
}

function formatCardLine(card: PriorityCardInput): string {
  const front = truncate(normalizeText(card.front), MAX_FRONT_LENGTH);
  const options = (card.options || [])
    .map((opt) => truncate(normalizeText(opt), MAX_OPTION_LENGTH))
    .filter(Boolean)
    .join('; ');
  const tags = (card.tags || [])
    .map((tag) => normalizeWhitespace(tag))
    .filter(Boolean)
    .slice(0, 6)
    .join(', ');

  let line = `- id:${card.id} | Frage: ${front}`;
  if (options) line += ` | Optionen: ${options}`;
  if (tags) line += ` | Tags: ${tags}`;
  return line;
}

function parseIdList(text: string): string[] | null {
  const parsed = safeJsonParse<unknown>(text);
  if (!parsed) return null;
  if (Array.isArray(parsed)) {
    return parsed.map(normalizeId).filter(Boolean) as string[];
  }
  if (typeof parsed === 'object' && parsed) {
    const obj = parsed as { ids?: unknown; priorities?: unknown; cards?: unknown };
    const idsValue = obj.ids || obj.cards;
    if (Array.isArray(idsValue)) {
      return idsValue.map(normalizeId).filter(Boolean) as string[];
    }
    if (Array.isArray(obj.priorities)) {
      return obj.priorities
        .map((entry) => (isRecord(entry) ? normalizeId(entry.id) : normalizeId(entry)))
        .filter(Boolean) as string[];
    }
  }
  return null;
}

function parsePriorities(text: string): PriorityCandidate[] | null {
  const parsed = safeJsonParse<unknown>(text);
  if (!parsed) return null;
  const list = Array.isArray(parsed)
    ? parsed
    : typeof parsed === 'object' && parsed
      ? (parsed as { priorities?: unknown; items?: unknown; cards?: unknown }).priorities ||
        (parsed as { items?: unknown }).items ||
        (parsed as { cards?: unknown }).cards
      : null;
  if (!Array.isArray(list)) return null;
  return list
    .map((entry: unknown, index: number) => {
      if (entry === null || entry === undefined) return null;
      if (typeof entry === 'string' || typeof entry === 'number') {
        return { id: String(entry).trim(), rank: index + 1 };
      }
      if (!isRecord(entry)) return null;
      const id = normalizeId(entry.id ?? entry.noteId ?? entry.cardId ?? entry.index);
      if (!id) return null;
      const rank = typeof entry.rank === 'number' ? entry.rank : undefined;
      const topic = typeof entry.topic === 'string'
        ? entry.topic
        : typeof entry.thema === 'string'
          ? entry.thema
          : typeof entry.fach === 'string'
            ? entry.fach
            : '';
      const reason = typeof entry.reason === 'string'
        ? entry.reason
        : typeof entry.begründung === 'string'
          ? entry.begründung
          : typeof entry.begruendung === 'string'
            ? entry.begruendung
            : typeof entry.grund === 'string'
              ? entry.grund
              : '';
      // Parse learning goals
      const learningGoals = Array.isArray(entry.learningGoals)
        ? entry.learningGoals.filter((g): g is string => typeof g === 'string')
        : Array.isArray(entry.lernziele)
          ? entry.lernziele.filter((g): g is string => typeof g === 'string')
          : undefined;
      return { id, rank, topic, reason, learningGoals };
    })
    .filter(Boolean) as PriorityCandidate[];
}

function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-zA-Z0-9äöüß]+/g) || [];
  return tokens.filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function fallbackPriorities(cards: PriorityCardInput[], topN: number): PrioritySuggestion[] {
  const tokenFrequency = new Map<string, number>();
  const cardTokens = new Map<string, string[]>();

  for (const card of cards) {
    const content = [card.front, ...(card.options || []), ...(card.tags || [])].join(' ');
    const uniqueTokens = Array.from(new Set(tokenize(normalizeText(content))));
    cardTokens.set(card.id, uniqueTokens);
    for (const token of uniqueTokens) {
      tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
    }
  }

  const scored = cards.map((card) => {
    const tokens = cardTokens.get(card.id) || [];
    const score = tokens.reduce((sum, token) => sum + (tokenFrequency.get(token) || 0), 0);
    const adjusted = score / Math.sqrt(Math.max(1, tokens.length));
    let bestToken = '';
    let bestScore = 0;
    for (const token of tokens) {
      const freq = tokenFrequency.get(token) || 0;
      if (freq > bestScore) {
        bestScore = freq;
        bestToken = token;
      }
    }
    return { card, adjusted, bestToken };
  });

  scored.sort((a, b) => b.adjusted - a.adjusted);

  return scored.slice(0, topN).map((entry, index) => {
    const topic = entry.bestToken || 'Grundlagen';
    return {
      id: entry.card.id,
      rank: index + 1,
      front: normalizeText(entry.card.front),
      topic,
      reason: `Häufiges Thema im Deck; deckt zentrale Begriffe wie "${topic}" ab.`,
      learningGoals: [`Kernkonzepte zu "${topic}" verstehen`, 'Klinische Relevanz einordnen'],
    };
  });
}

async function llmPickIds(
  cards: PriorityCardInput[],
  count: number,
  llmConfig: LlmConfig
): Promise<string[]> {
  const prompt = `Du bist Lerncoach fuer Medizinstudierende.
Waehle die ${count} wichtigsten Karten fuer maximalen 80/20 Lernerfolg (Pruefungsrelevanz, Grundlagen, typische Fehler).
Achte auf Themenbreite.

Antworte nur als JSON:
{ "ids": ["id1", "id2", "..."] }

Karten:
${cards.map(formatCardLine).join('\n')}`;
  const text = await generateTextWithFallback(prompt, llmConfig);
  const ids = parseIdList(text);
  if (!ids || ids.length === 0) {
    throw new Error('Failed to parse priority IDs');
  }
  return ids;
}

async function llmPickPriorities(
  cards: PriorityCardInput[],
  count: number,
  llmConfig: LlmConfig
): Promise<PriorityCandidate[]> {
  // IDs als Referenz mitgeben
  const cardLines = cards.map((card, idx) => {
    const idPart = `[${idx}]`;
    const front = truncate(normalizeText(card.front), MAX_FRONT_LENGTH);
    return `${idPart} ${front}`;
  }).join('\n');

  const prompt = `Du bist ein Lerncoach für Medizinstudierende.
Analysiere die folgenden Lernkarten und identifiziere die TOP ${count} WICHTIGSTEN THEMEN für den 80/20-Lernerfolg.

WICHTIG:
- Gruppiere nach ÜBERGEORDNETEN THEMEN, nicht einzelnen Fragen
- Jedes Thema sollte ein klinisch relevantes Konzept sein
- Nenne konkrete Lernziele

Antworte NUR mit diesem JSON (keine Erklärungen davor/danach):
{
  "themen": [
    {
      "index": 0,
      "thema": "Beispiel: Angeborene Herzfehler im Neugeborenenscreening",
      "wichtigkeit": "Häufige Prüfungsfrage, klinisch hochrelevant",
      "lernziele": ["Kritische Herzfehler erkennen", "Screening-Methoden verstehen", "Notfallmanagement"]
    }
  ]
}

Die Karten (mit Index):
${cardLines}`;

  const text = await generateTextWithFallback(prompt, llmConfig);
  
  // Flexibleres Parsing
  const parsed = safeJsonParse<unknown>(text);
  if (!parsed || typeof parsed !== 'object') {
    console.error('LLM returned invalid JSON:', text.substring(0, 500));
    throw new Error('LLM hat kein gültiges JSON zurückgegeben');
  }
  
  const obj = parsed as Record<string, unknown>;
  const list = obj.themen || obj.priorities || obj.topics || obj.items;
  
  if (!Array.isArray(list) || list.length === 0) {
    console.error('LLM returned no themes:', text.substring(0, 500));
    throw new Error('LLM hat keine Themen identifiziert');
  }
  
  const results: PriorityCandidate[] = [];
  for (let i = 0; i < list.length && results.length < count; i++) {
    const entry = list[i];
    if (!entry || typeof entry !== 'object') continue;
    
    const e = entry as Record<string, unknown>;
    const index = typeof e.index === 'number' ? e.index : i;
    const cardId = cards[index]?.id || cards[i]?.id || String(i);
    
    const topic = String(e.thema || e.topic || e.name || 'Thema');
    const reason = String(e.wichtigkeit || e.reason || e.grund || '');
    const goals = Array.isArray(e.lernziele) ? e.lernziele.filter((g): g is string => typeof g === 'string')
      : Array.isArray(e.learningGoals) ? e.learningGoals.filter((g): g is string => typeof g === 'string')
      : undefined;
    
    results.push({
      id: cardId,
      rank: results.length + 1,
      topic,
      reason,
      learningGoals: goals,
    });
  }
  
  if (results.length === 0) {
    throw new Error('Konnte keine Themen aus LLM-Antwort extrahieren');
  }
  
  return results;
}

export async function suggestTopPriorities(
  cards: PriorityCardInput[],
  options?: PriorityOptions
): Promise<{ priorities: PrioritySuggestion[]; method: 'llm' | 'fallback'; error?: string }> {
  const cleaned = cards
    .map((card) => ({
      ...card,
      id: normalizeId(card.id) || '',
      front: normalizeText(card.front || ''),
      options: (card.options || []).map((opt) => normalizeText(opt)),
      tags: (card.tags || []).map((tag) => normalizeWhitespace(tag)),
    }))
    .filter((card) => card.id && card.front);

  const topN = Math.min(Math.max(1, options?.topN ?? DEFAULT_TOP_N), 50);
  if (cleaned.length === 0) {
    return { priorities: [], method: 'fallback', error: 'Keine gültigen Karten gefunden' };
  }

  // LLM Config bauen - bei Fehler abbrechen statt Fallback
  let llmConfig: LlmConfig;
  try {
    llmConfig = buildLlmConfig(options);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Priority LLM config failed:', msg);
    return { 
      priorities: [], 
      method: 'fallback', 
      error: `LLM nicht verfügbar: ${msg}. Bitte API-Key prüfen.`
    };
  }

  const byId = new Map(cleaned.map((card) => [card.id, card]));
  
  try {
    // Bei vielen Karten: Zufällige Stichprobe nehmen statt alle zu chunken
    let sample = cleaned;
    const maxSampleSize = 120; // Max 120 Karten für LLM analysieren
    
    if (cleaned.length > maxSampleSize) {
      // Gleichmäßig über das Deck verteilt samplen
      const step = Math.floor(cleaned.length / maxSampleSize);
      sample = [];
      for (let i = 0; i < cleaned.length && sample.length < maxSampleSize; i += step) {
        sample.push(cleaned[i]);
      }
      console.log(`Sampling ${sample.length} of ${cleaned.length} cards for priority analysis`);
    }

    // LLM direkt für Themen-Identifikation aufrufen
    const prioritiesRaw = await llmPickPriorities(sample, topN, llmConfig);
    
    const sortedRaw = [...prioritiesRaw].sort((a, b) => {
      const rankA = typeof a.rank === 'number' ? a.rank : Number.POSITIVE_INFINITY;
      const rankB = typeof b.rank === 'number' ? b.rank : Number.POSITIVE_INFINITY;
      return rankA - rankB;
    });
    
    const priorities: PrioritySuggestion[] = [];
    const seenTopics = new Set<string>();

    for (const item of sortedRaw) {
      const card = byId.get(item.id);
      if (!card) continue;
      
      // Duplikate nach Topic vermeiden
      const topicKey = (item.topic || '').toLowerCase().trim();
      if (topicKey && seenTopics.has(topicKey)) continue;
      if (topicKey) seenTopics.add(topicKey);
      
      priorities.push({
        id: item.id,
        rank: priorities.length + 1,
        front: card.front,
        topic: item.topic || 'Kernthema',
        reason: item.reason || 'Prüfungsrelevantes Konzept.',
        learningGoals: item.learningGoals,
      });
      if (priorities.length >= topN) break;
    }

    if (priorities.length === 0) {
      throw new Error('LLM hat keine Themen identifiziert');
    }

    return { priorities: priorities.slice(0, topN), method: 'llm' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Priority LLM failed:', msg);
    return { 
      priorities: [], 
      method: 'fallback', 
      error: `LLM-Analyse fehlgeschlagen: ${msg}`
    };
  }
}
