import { NextRequest, NextResponse } from 'next/server';
import { enrichCards } from '@/lib/enrich';

// Laufzeit pro Batch (~5 Karten × ~14s) kann ~2 Min. sein
export const maxDuration = 300;

const ANKICONNECT_URL = process.env.ANKICONNECT_URL || 'http://localhost:8765';

function isLocalhost(url: string): boolean {
  try {
    return new URL(url).hostname === 'localhost' || new URL(url).hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function sanitize(s: string) {
  return s.replace(/[<>"']/g, '').trim();
}

async function ankiRequest(request: unknown): Promise<unknown> {
  if (!isLocalhost(ANKICONNECT_URL)) {
    throw new Error('AnkiConnect is only available on localhost');
  }
  const res = await fetch(ANKICONNECT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(`AnkiConnect: ${res.statusText}`);
  const data = (await res.json()) as { error?: string; result?: unknown };
  if (data.error) throw new Error(`AnkiConnect: ${data.error}`);
  return data.result;
}

async function getCardsFromDeck(deckName: string): Promise<
  Array<{ front: string; back: string; options: string[]; answers: string }>
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
  })) as Array<{ fields?: Record<string, { value?: string }> }>;

  const cards: Array<{ front: string; back: string; options: string[]; answers: string }> = [];

  for (const note of notesInfo) {
    const f = note.fields || {};
    const q =
      f['Question']?.value ||
      f['Frage']?.value ||
      f['Front']?.value ||
      f['Text']?.value ||
      f['Cloze']?.value ||
      '';
    const options: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const o = f[`Q_${i}`]?.value?.trim();
      if (o) options.push(o);
    }
    const answers =
      f['Answers']?.value || f['Antwort']?.value || f['Back']?.value || '';
    const front = q.trim() || (f['Text']?.value || '').trim();
    const back = answers.trim();
    if (!front) continue;
    cards.push({ front, back, options, answers });
  }
  return cards;
}

const BATCH_SIZE = 5; // 5 Karten pro Request (~1–2 min) wegen Rate-Limit

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const deckName = sanitize(body.deckName || '');
    const limit = Math.min(Math.max(1, parseInt(String(body.limit || 100), 10) || 100), 500);
    const offset = Math.max(0, parseInt(String(body.offset || 0), 10) || 0);

    if (!deckName) {
      return NextResponse.json({ error: 'deckName is required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not set. Bitte in .env.local setzen.' },
        { status: 500 }
      );
    }

    await ankiRequest({ action: 'version', version: 6 });

    const all = await getCardsFromDeck(deckName);
    const toProcess = all.slice(0, limit);
    const total = toProcess.length;

    if (total === 0) {
      return NextResponse.json({
        success: true,
        enriched: [],
        nextOffset: 0,
        total: 0,
        hasMore: false,
        message: 'Keine Karten mit gültigem Front-Feld in diesem Deck gefunden.',
      });
    }

    const batch = toProcess.slice(offset, offset + BATCH_SIZE).map((c) => ({
      front: c.front.replace(/<br>/g, ' ').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim(),
      back: c.back,
      options: c.options,
      answers: c.answers,
    }));

    if (batch.length === 0) {
      return NextResponse.json({
        success: true,
        enriched: [],
        nextOffset: offset,
        total,
        hasMore: false,
      });
    }

    const enriched = await enrichCards(batch, apiKey);
    const nextOffset = offset + batch.length;
    const hasMore = nextOffset < total;

    return NextResponse.json({
      success: true,
      enriched,
      nextOffset,
      total,
      hasMore,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
