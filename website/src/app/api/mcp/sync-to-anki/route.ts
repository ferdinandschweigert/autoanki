import { NextRequest, NextResponse } from 'next/server';

const ANKICONNECT_URL = process.env.ANKICONNECT_URL || 'http://localhost:8765';

function isLocalhost(url: string): boolean {
  try {
    return new URL(url).hostname === 'localhost' || new URL(url).hostname === '127.0.0.1';
  } catch {
    return false;
  }
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

const ENRICHED_MODEL_PARAMS = {
  modelName: 'Enriched Card',
  inOrderFields: ['Front', 'Back', 'Original-Antwort', 'Optionen', 'Lösung', 'Erklärung', 'Eselsbrücke', 'Referenz', 'Extra 1'],
  css: `
.card{font-family:Arial,sans-serif;font-size:20px;text-align:center;color:#000;background:#fff}
.front{font-weight:bold;font-size:24px;margin-bottom:20px}
.back{margin-bottom:20px}
.original-antwort{background:#f5f5f5;padding:10px;margin:10px 0;border-left:3px solid #9e9e9e;text-align:left;font-size:16px;color:#666}
.lösung{background:#e3f2fd;padding:15px;margin:20px 0;border-left:4px solid #2196F3;text-align:left;font-weight:bold;font-size:22px}
.erklärung{background:#f0f0f0;padding:15px;margin-top:20px;border-left:4px solid #4CAF50;text-align:left}
.eselsbrücke{background:#fff3cd;padding:15px;margin-top:10px;border-left:4px solid #ffc107;text-align:left;font-style:italic}
.referenz{background:#e8f5e9;padding:10px;margin-top:15px;border-left:4px solid #66bb6a;text-align:left;font-size:14px;color:#555}
.extra1{background:#f3e5f5;padding:15px;margin-top:15px;border-left:4px solid #9c27b0;text-align:left;font-size:16px}
.optionen{background:#fff9e6;padding:12px;margin:10px 0;border-left:3px solid #ff9800;text-align:left;font-size:16px}
  `,
  cardTemplates: [
    {
      Name: 'Card 1',
      Front: '<div class="front">{{Front}}</div>',
      Back: `
<div class="front">{{Front}}</div><hr>
{{#Optionen}}<div class="optionen"><strong>📋 OPTIONEN:</strong><br>{{Optionen}}</div>{{/Optionen}}
{{#Lösung}}<div class="lösung">✅ <strong>LÖSUNG:</strong><br>{{Lösung}}</div>{{/Lösung}}
{{#Original-Antwort}}<div class="original-antwort"><strong>Original-Antwort (Binärcode):</strong><br>{{Original-Antwort}}</div>{{/Original-Antwort}}
{{#Erklärung}}<div class="erklärung"><strong>📚 ERKLÄRUNG:</strong><br>{{Erklärung}}</div>{{/Erklärung}}
{{#Eselsbrücke}}<div class="eselsbrücke"><strong>💡 ESELSBRÜCKE:</strong><br>{{Eselsbrücke}}</div>{{/Eselsbrücke}}
{{#Referenz}}<div class="referenz"><strong>📖 REFERENZ:</strong> {{Referenz}}</div>{{/Referenz}}
{{#Extra 1}}<div class="extra1"><strong>📝 EXTRA 1:</strong><br>{{Extra 1}}</div>{{/Extra 1}}
      `,
    },
  ],
};

interface EnrichedCard {
  front: string;
  back: string;
  options?: string[];
  lösung: string;
  erklärung: string;
  eselsbrücke: string;
  referenz: string;
  extra1?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const deckName = (body.deckName || '').replace(/[<>"']/g, '').trim();
    const cards = Array.isArray(body.cards) ? body.cards as EnrichedCard[] : [];

    if (!deckName) {
      return NextResponse.json({ error: 'deckName is required' }, { status: 400 });
    }
    if (cards.length === 0) {
      return NextResponse.json({ error: 'cards array is required and must not be empty' }, { status: 400 });
    }

    await ankiRequest({ action: 'version', version: 6 });

    const models = (await ankiRequest({ action: 'modelNames', version: 6 })) as string[];
    if (!models.includes('Enriched Card')) {
      await ankiRequest({ action: 'createModel', version: 6, params: ENRICHED_MODEL_PARAMS });
    }

    const decks = (await ankiRequest({ action: 'deckNames', version: 6 })) as string[];
    if (!decks.includes(deckName)) {
      await ankiRequest({ action: 'createDeck', version: 6, params: { deck: deckName } });
    }

    const batchSize = 10;
    const noteIds: number[] = [];
    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize);
      const results = (await ankiRequest({
        action: 'addNotes',
        version: 6,
        params: {
          notes: batch.map((c) => ({
            deckName,
            modelName: 'Enriched Card',
            fields: {
              Front: c.front || '',
              Back: c.back || '',
              'Original-Antwort': c.back || '',
              Optionen: c.options && c.options.length > 0 
                ? c.options.map((opt, idx) => `${idx + 1}. ${opt}`).join('<br>')
                : '',
              Lösung: c.lösung || '',
              Erklärung: c.erklärung || '',
              Eselsbrücke: c.eselsbrücke || '',
              Referenz: c.referenz || '',
              'Extra 1': c.extra1 || '',
            },
            tags: [],
          })),
        },
      })) as number[];
      noteIds.push(...results);
    }

    return NextResponse.json({
      success: true,
      noteIds,
      count: noteIds.length,
      message: `${noteIds.length} Karten zu "${deckName}" hinzugefügt.`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
