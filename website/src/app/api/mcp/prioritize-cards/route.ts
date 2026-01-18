import { NextRequest, NextResponse } from 'next/server';
import { suggestTopPriorities } from '@/lib/priorities';

export const maxDuration = 300;

const ANKICONNECT_URL = process.env.ANKICONNECT_URL || 'http://localhost:8765';

function isLocalhost(url: string): boolean {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function sanitize(value: string): string {
  return value.replace(/[<>"']/g, '').trim();
}

async function ankiRequest(request: unknown): Promise<unknown> {
  if (!isLocalhost(ANKICONNECT_URL)) {
    throw new Error('AnkiConnect is only available on localhost for security reasons');
  }
  const response = await fetch(ANKICONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`AnkiConnect error: ${response.statusText}`);
  }
  const data = (await response.json()) as { error?: string; result?: unknown };
  if (data.error) {
    throw new Error(`AnkiConnect error: ${data.error}`);
  }
  return data.result;
}

async function getCardsFromDeck(deckName: string): Promise<
  Array<{ id: string; front: string; options: string[]; tags: string[] }>
> {
  const noteIds = (await ankiRequest({
    action: 'findNotes',
    version: 6,
    params: { query: `deck:"${deckName}"` },
  })) as number[];

  if (!noteIds?.length) return [];

  const notesInfo = (await ankiRequest({
    action: 'notesInfo',
    version: 6,
    params: { notes: noteIds },
  })) as Array<{ noteId?: number; fields?: Record<string, { value?: string }>; tags?: string[] }>;

  const cards: Array<{ id: string; front: string; options: string[]; tags: string[] }> = [];

  for (const note of notesInfo) {
    const fields = note.fields || {};
    const question =
      fields['Question']?.value ||
      fields['Frage']?.value ||
      fields['Front']?.value ||
      fields['Text']?.value ||
      fields['Cloze']?.value ||
      '';
    const options: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const option = fields[`Q_${i}`]?.value || '';
      if (option && option.trim().length > 0) options.push(option.trim());
    }
    const front = question.trim() || (fields['Text']?.value || '').trim();
    if (!front) continue;
    cards.push({
      id: String(note.noteId ?? `${cards.length + 1}`),
      front,
      options,
      tags: note.tags || [],
    });
  }

  return cards;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const deckName = sanitize(body.deckName || '');
    const limit = Math.min(Math.max(1, parseInt(String(body.limit || 300), 10) || 300), 1000);
    const topN = Math.min(Math.max(1, parseInt(String(body.topN || 15), 10) || 15), 50);
    const fallbackProviders = Array.isArray(body.fallbackProviders)
      ? body.fallbackProviders
      : typeof body.fallbackProviders === 'string'
        ? body.fallbackProviders.split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;

    if (!deckName) {
      return NextResponse.json({ error: 'deckName is required' }, { status: 400 });
    }

    await ankiRequest({ action: 'version', version: 6 });

    const allCards = await getCardsFromDeck(deckName);
    const considered = allCards.slice(0, limit);

    if (considered.length === 0) {
      return NextResponse.json({
        success: true,
        priorities: [],
        total: allCards.length,
        considered: 0,
        method: 'fallback',
        message: 'Keine Karten mit gültigem Front-Feld in diesem Deck gefunden.',
      });
    }

    const { priorities, method, error: llmError } = await suggestTopPriorities(considered, {
      topN,
      provider: body.provider,
      model: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      fallbackProviders,
    });

    // Bei LLM-Fehler als Fehler zurückgeben, nicht als leeres Ergebnis
    if (llmError && priorities.length === 0) {
      return NextResponse.json({
        success: false,
        error: llmError,
        priorities: [],
        total: allCards.length,
        considered: considered.length,
        method,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      priorities,
      total: allCards.length,
      considered: considered.length,
      method,
      ...(llmError ? { warning: llmError } : {}),
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
