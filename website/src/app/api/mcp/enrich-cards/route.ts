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

function sanitizeForPrompt(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getCardsByNoteIds(
  noteIds: number[]
): Promise<{ cards: Array<{ front: string; back: string; options: string[]; answers: string }>; skippedEmpty: number }> {
  if (!noteIds.length) {
    return { cards: [], skippedEmpty: 0 };
  }

  const notesInfo = (await ankiRequest({
    action: 'notesInfo',
    version: 6,
    params: { notes: noteIds },
  })) as Array<{ fields?: Record<string, { value?: string }> }>;

  const cards: Array<{ front: string; back: string; options: string[]; answers: string }> = [];
  let skippedEmpty = 0;

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
      const o = f[`Q_${i}`]?.value;
      if (o && o.trim().length > 0) {
        options.push(sanitizeForPrompt(o));
      }
    }
    const answers =
      f['Answers']?.value || f['Antwort']?.value || f['Back']?.value || '';
    const frontRaw = q.trim() || (f['Text']?.value || '').trim();
    const front = sanitizeForPrompt(frontRaw);
    const back = answers.trim();
    if (!front) {
      skippedEmpty += 1;
      continue;
    }
    cards.push({ front, back, options, answers: back });
  }

  return { cards, skippedEmpty };
}

const BATCH_SIZE = 5; // 5 Karten pro Request (~1–2 min) wegen Rate-Limit

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const deckName = sanitize(body.deckName || '');
    const requestedLimit = parseInt(String(body.limit || BATCH_SIZE), 10);
    const limit = Number.isFinite(requestedLimit) ? requestedLimit : BATCH_SIZE;
    const offset = Math.max(0, parseInt(String(body.offset || 0), 10) || 0);
    const fallbackProviders = Array.isArray(body.fallbackProviders)
      ? body.fallbackProviders
      : typeof body.fallbackProviders === 'string'
        ? body.fallbackProviders.split(',').map((s: string) => s.trim()).filter(Boolean)
        : undefined;
    const requestDelayMs = Number.isFinite(Number(body.requestDelayMs))
      ? Number(body.requestDelayMs)
      : undefined;

    if (!deckName) {
      return NextResponse.json({ error: 'deckName is required' }, { status: 400 });
    }

    const llmOverrides = {
      provider: body.provider,
      model: body.model,
      apiKey: body.apiKey,
      baseUrl: body.baseUrl,
      fallbackProviders,
      requestDelayMs,
    };

    await ankiRequest({ action: 'version', version: 6 });

    const noteIds = (await ankiRequest({
      action: 'findNotes',
      version: 6,
      params: { query: `deck:"${deckName}"` },
    })) as number[];

    const total = noteIds.length;

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

    const effectiveLimit = Math.min(Math.max(1, limit), BATCH_SIZE);
    const batchNoteIds = noteIds.slice(offset, offset + effectiveLimit);

    if (batchNoteIds.length === 0) {
      return NextResponse.json({
        success: true,
        enriched: [],
        nextOffset: offset,
        total,
        hasMore: false,
        skippedEmpty: 0,
      });
    }

    const { cards: batch, skippedEmpty } = await getCardsByNoteIds(batchNoteIds);

    if (batch.length === 0) {
      const nextOffset = offset + batchNoteIds.length;
      const hasMore = nextOffset < total;
      return NextResponse.json({
        success: true,
        enriched: [],
        nextOffset,
        total,
        hasMore,
        skippedEmpty,
      });
    }

    const enriched = await enrichCards(batch, llmOverrides);
    const nextOffset = offset + batchNoteIds.length;
    const hasMore = nextOffset < total;

    return NextResponse.json({
      success: true,
      enriched,
      nextOffset,
      total,
      hasMore,
      skippedEmpty,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
