'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  BookOpen, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  RefreshCw,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';

interface Deck {
  name: string;
  cardCount?: number;
}

interface AnkiCard {
  front: string;
  back: string;
  question: string;
  options: string[];
  answers: string;
  qType: number;
}

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

export default function Dashboard() {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [selectedDeck, setSelectedDeck] = useState<string>('');
  const [cards, setCards] = useState<AnkiCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');
  const [isHosted, setIsHosted] = useState<boolean | null>(null);

  // Anreicherung
  const [enrichLimit, setEnrichLimit] = useState(100);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);
  const [enrichedCards, setEnrichedCards] = useState<EnrichedCard[]>([]);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const [syncTargetDeck, setSyncTargetDeck] = useState('');
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  const loadDecks = async () => {
    if (isHosted) return;
    setLoading(true);
    setError(null);
    setStatus('Lade Decks...');
    try {
      const response = await fetch('/api/mcp/list-decks');
      const data = await response.json();
      if (data.success) {
        setDecks(data.decks.map((name: string) => ({ name })));
        setStatus(`${data.decks.length} Decks geladen`);
      } else {
        throw new Error(data.error || 'Failed to load decks');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler beim Laden der Decks');
      setStatus('Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const loadCards = async (deckName: string) => {
    if (!deckName || isHosted) return;
    setLoading(true);
    setError(null);
    setStatus(`Lade Karten aus "${deckName}"...`);
    try {
      const response = await fetch('/api/mcp/get-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckName }),
      });
      const data = await response.json();
      if (data.success) {
        setCards(data.cards || []);
        setStatus(`${data.count || 0} Karten geladen`);
      } else {
        throw new Error(data.error || 'Failed to load cards');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler beim Laden der Karten');
      setStatus('Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const host = window.location.hostname;
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1';
    setIsHosted(!isLocal);
  }, []);

  useEffect(() => {
    if (isHosted === null) return;
    if (isHosted) {
      setError(null);
      setStatus('AnkiConnect nur lokal verfügbar');
      return;
    }
    loadDecks();
  }, [isHosted]);

  useEffect(() => {
    if (isHosted || !selectedDeck) {
      return;
    }
    loadCards(selectedDeck);
  }, [isHosted, selectedDeck]);

  useEffect(() => {
    if (selectedDeck) {
      setSyncTargetDeck(`${selectedDeck} (angereichert)`);
    }
  }, [selectedDeck]);

  const runEnrich = async () => {
    if (!selectedDeck || isHosted) return;
    setEnriching(true);
    setEnrichError(null);
    setEnrichedCards([]);
    setEnrichProgress({ done: 0, total: enrichLimit });
    let all: EnrichedCard[] = [];
    let offset = 0;
    try {
      for (;;) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 Min. Timeout pro Batch
        
        let res: Response;
        try {
          res = await fetch('/api/mcp/enrich-cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deckName: selectedDeck, limit: enrichLimit, offset }),
            signal: controller.signal,
          });
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            throw new Error('Timeout: Der Batch hat zu lange gedauert (>3 Min.). Bitte erneut versuchen.');
          }
          throw new Error(`Netzwerkfehler: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`);
        }
        clearTimeout(timeoutId);
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(errorData.error || `HTTP ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Enrichment fehlgeschlagen');
        
        all = all.concat(data.enriched || []);
        setEnrichedCards(all);
        setEnrichProgress({ done: data.nextOffset ?? offset + (data.enriched?.length || 0), total: data.total ?? enrichLimit });
        if (!data.hasMore) break;
        offset = data.nextOffset;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setEnrichError(msg);
      console.error('Enrichment error:', e);
    } finally {
      setEnriching(false);
      setEnrichProgress(null);
    }
  };

  const runSync = async () => {
    if (!syncTargetDeck.trim() || enrichedCards.length === 0) return;
    setSyncLoading(true);
    setSyncError(null);
    try {
      const res = await fetch('/api/mcp/sync-to-anki', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckName: syncTargetDeck.trim(), cards: enrichedCards }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync fehlgeschlagen');
    } catch (e: unknown) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-5 w-5 text-blue-600" />
                Anki Dashboard
              </CardTitle>
              <CardDescription>
                Verbinde dich mit Anki Desktop und verwalte deine Decks
              </CardDescription>
            </div>
            <Button 
              onClick={loadDecks} 
              variant="outline" 
              size="sm"
              disabled={loading || isHosted === true}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Aktualisieren
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          )}

          {isHosted && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-800">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">
                AnkiConnect funktioniert nur lokal mit Anki Desktop. Diese Funktionen sind auf Vercel deaktiviert.
              </span>
            </div>
          )}
          
          {status && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-blue-700">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm">{status}</span>
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-700 mb-2">
                Deck auswählen:
              </label>
              <select
                value={selectedDeck}
                onChange={(e) => setSelectedDeck(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={loading || decks.length === 0 || isHosted === true}
              >
                <option value="">-- Deck auswählen --</option>
                {decks.map((deck) => (
                  <option key={deck.name} value={deck.name}>
                    {deck.name}
                  </option>
                ))}
              </select>
            </div>

            {decks.length === 0 && !loading && !isHosted && (
              <div className="text-center py-8 text-zinc-500">
                <p>Keine Decks gefunden.</p>
                <p className="text-sm mt-2">
                  Stelle sicher, dass Anki Desktop läuft und AnkiConnect installiert ist.
                </p>
              </div>
            )}

            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
                <span className="ml-2 text-zinc-600">Lade...</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Anreicherung */}
      {!isHosted && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-500" />
              Karten anreichern
            </CardTitle>
            <CardDescription>
              KI-Erklärungen, Eselsbrücken und Referenzen für ein Deck generieren (Gemini). Pro Batch 5 Karten, ~1–2 Min. pro Batch.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {enrichError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{enrichError}</span>
              </div>
            )}

            {/* Fortschritt: sofort sichtbar, sobald Anreicherung läuft */}
            {enriching && enrichProgress && (
              <div className="p-4 bg-amber-50 border-2 border-amber-300 rounded-lg">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-amber-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-amber-900">Anreicherung läuft</p>
                    <p className="text-amber-800 text-sm mt-0.5">
                      Fortschritt: <strong>{enrichProgress.done} von {enrichProgress.total}</strong> Karten
                    </p>
                    {enrichProgress.done === 0 ? (
                      <p className="text-amber-700 text-sm mt-1">
                        Der erste Batch (5 Karten) kann 1–2 Minuten dauern. Bitte warten…
                      </p>
                    ) : (
                      <p className="text-amber-700 text-sm mt-1">Nächster Batch wird verarbeitet…</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Anzahl Karten (Max.)</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={enrichLimit}
                  onChange={(e) => setEnrichLimit(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                  className="w-24 px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={enriching}
                />
              </div>
              <Button
                onClick={runEnrich}
                disabled={enriching || !selectedDeck || decks.length === 0}
              >
                {enriching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {enrichProgress ? ` ${enrichProgress.done}/${enrichProgress.total} …` : ' Anreichern…'}
                  </>
                ) : (
                  <>Erste {enrichLimit} Karten anreichern</>
                )}
              </Button>
            </div>
            {enrichProgress && !enriching && (
              <p className="text-sm text-zinc-600">
                {enrichProgress.done} von {enrichProgress.total} Karten angereichert.
              </p>
            )}

            {enrichedCards.length > 0 && (
              <div className="space-y-4 border-t border-zinc-200 pt-4">
                <h4 className="font-medium text-zinc-900">Angereicherte Karten ({enrichedCards.length})</h4>
                <div className="max-h-96 overflow-y-auto space-y-3">
                  {enrichedCards.slice(0, 20).map((c, i) => (
                    <div key={i} className="p-3 border border-zinc-200 rounded-lg bg-zinc-50">
                      <button
                        type="button"
                        className="w-full text-left flex justify-between items-center"
                        onClick={() => setExpandedCard(expandedCard === i ? null : i)}
                      >
                        <span className="text-sm font-medium text-zinc-900 line-clamp-2">{c.front}</span>
                        {expandedCard === i ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                      {expandedCard === i && (
                        <div className="mt-3 space-y-2 text-sm">
                          {c.options && c.options.length > 0 && (
                            <div>
                              <span className="font-medium text-orange-700">Optionen:</span>
                              <ul className="list-disc list-inside mt-1 text-zinc-700">
                                {c.options.map((opt, idx) => (
                                  <li key={idx}>{idx + 1}. {opt}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          <div><span className="font-medium text-blue-700">Lösung:</span> <span className="text-zinc-700">{c.lösung}</span></div>
                          <div><span className="font-medium text-zinc-600">Original-Antwort (Binärcode):</span> <span className="text-zinc-600 font-mono">{c.back}</span></div>
                          <div><span className="font-medium text-green-700">Erklärung:</span> <span className="text-zinc-700 whitespace-pre-wrap">{c.erklärung}</span></div>
                          {c.eselsbrücke && <div><span className="font-medium text-amber-700">Eselsbrücke:</span> <span className="text-zinc-700">{c.eselsbrücke}</span></div>}
                          {c.referenz && <div><span className="font-medium text-zinc-600">Referenz:</span> <span className="text-zinc-600">{c.referenz}</span></div>}
                          {c.extra1 && <div><span className="font-medium text-purple-700">Extra 1:</span> <span className="text-zinc-700">{c.extra1}</span></div>}
                        </div>
                      )}
                    </div>
                  ))}
                  {enrichedCards.length > 20 && (
                    <p className="text-sm text-zinc-500">… und {enrichedCards.length - 20} weitere</p>
                  )}
                </div>
                <div className="flex flex-wrap items-end gap-4">
                  <div>
                    <label className="block text-sm font-medium text-zinc-700 mb-1">Ziel-Deck in Anki</label>
                    <input
                      type="text"
                      value={syncTargetDeck}
                      onChange={(e) => setSyncTargetDeck(e.target.value)}
                      placeholder="z.B. Mein Deck (angereichert)"
                      className="w-64 px-3 py-2 border border-zinc-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={syncLoading}
                    />
                  </div>
                  <Button onClick={runSync} disabled={syncLoading}>
                    {syncLoading ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Wird hinzugefügt…</>
                    ) : (
                      <><Download className="h-4 w-4 mr-2" /> Zu Anki hinzufügen</>
                    )}
                  </Button>
                </div>
                {syncError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">{syncError}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {selectedDeck && cards.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Karten aus &quot;{selectedDeck}&quot;
            </CardTitle>
            <CardDescription>
              {cards.length} Karten gefunden
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 max-h-96 overflow-y-auto">
              {cards.slice(0, 10).map((card, index) => (
                <div
                  key={index}
                  className="p-4 border-2 border-blue-200 rounded-lg bg-white"
                >
                  <div className="flex items-start justify-between mb-2">
                    <Badge variant="secondary" className="text-xs">
                      {card.qType === 0 ? 'KPRIM' : card.qType === 1 ? 'MC' : 'SC'}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium text-zinc-900 mb-2">
                    {card.question || card.front}
                  </p>
                  {card.options && card.options.length > 0 && (
                    <div className="mt-2 space-y-1">
                      {card.options.map((option, optIndex) => (
                        <div key={optIndex} className="text-xs text-zinc-600">
                          • {option}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 text-xs text-zinc-500">
                    Antwort: {card.answers}
                  </div>
                </div>
              ))}
              {cards.length > 10 && (
                <div className="text-center text-sm text-zinc-500 py-2">
                  ... und {cards.length - 10} weitere Karten
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
