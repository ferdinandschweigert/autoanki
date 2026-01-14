import { GoogleGenerativeAI } from '@google/generative-ai';

export interface EnrichedCard {
  front: string;
  back: string;
  lösung: string;  // Die richtige Antwort/Lösung (ganz oben)
  erklärung: string;
  eselsbrücke: string;
  referenz: string;  // Quellenangabe (Lehrbuch/Leitlinie)
}

/**
 * Enrich a single card with German explanations using Gemini API
 */
export async function enrichCard(
  front: string,
  back: string,
  apiKey: string,
  options?: string[],
  answers?: string
): Promise<EnrichedCard> {
  const genAI = new GoogleGenerativeAI(apiKey);
  // Use gemini-2.5-flash (free tier) instead of gemini-pro-latest (which maps to gemini-2.5-pro, not free)
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  
  // Build options list if available
  let optionsText = '';
  if (options && options.length > 0) {
    optionsText = '\n\nOPTIONEN:\n';
    options.forEach((opt, idx) => {
      if (opt && opt.trim().length > 0) {
        optionsText += `${idx + 1}. ${opt}\n`;
      }
    });
  }
  
  // Parse binary answers if available
  let correctAnswersText = '';
  if (answers && options && options.length > 0) {
    const answerBits = answers.trim().split(/\s+/);
    const correctOptions: string[] = [];
    const incorrectOptions: string[] = [];
    
    answerBits.forEach((bit, idx) => {
      if (options[idx]) {
        if (bit === '1') {
          correctOptions.push(`${idx + 1}. ${options[idx]}`);
        } else {
          incorrectOptions.push(`${idx + 1}. ${options[idx]}`);
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
  
  const prompt = `Du bist ein hilfreicher Tutor für Universitätsprüfungen. 
Ergänze die folgende Multiple-Choice Lernkarte mit einer klaren, strukturierten Erklärung auf Deutsch.

FRAGE: ${front}${optionsText}${correctAnswersText}

${back ? `ANTWORT (Binärcode): ${back}` : ''}

WICHTIG - Dies ist eine Multiple-Choice Frage mit den oben genannten Optionen! Bitte erstelle die Erklärung im folgenden EXAKTEN Format:

1. LÖSUNG: Beginne mit "Die richtige Antwort lautet: [Liste der richtigen Optionen]." 
   - Verwende die oben angegebenen richtigen Antworten aus dem Binärcode
   - Falls die Frage nach "trifft nicht zu" fragt, identifiziere welche Aussage NICHT zutrifft

2. ERKLÄRUNG: Strukturiere die Erklärung wie folgt:
   a) Zuerst eine allgemeine Einführung zum Konzept/Erkrankung (2-3 Sätze)
   b) Dann "Erläuterung der richtigen Antwort(en):" - erkläre detailliert warum jede richtige Option richtig ist (für jede richtige Option 1-2 Sätze)
   c) Dann "Warum die anderen Optionen nicht korrekt sind:" - erkläre für jede falsche Option warum sie falsch ist (für jede falsche Option 1-2 Sätze)
   
   Beispiel-Struktur:
   "[Allgemeine Einführung]. Erläuterung der richtigen Antwort(en): Option 1 ist richtig, weil... Option 2 ist richtig, weil... Warum die anderen Optionen nicht korrekt sind: Option 3 ist falsch, weil... Option 4 ist falsch, weil..."

3. ESELSBRÜCKE: Eine Eselsbrücke (falls sinnvoll), die beim Merken hilft. Wenn keine gute Eselsbrücke möglich ist, lasse dieses Feld leer.

4. REFERENZ: Gib eine passende Referenz an, z.B. ein Standardlehrbuch oder eine Leitlinie. Beispiele:
   - "Duale Reihe Orthopädie, Kapitel [Thema]"
   - "AWMF-Leitlinie [Name]"
   - "Prometheus Lernatlas der Anatomie"
   - "Amboss - [Thema]"
   - "Herold Innere Medizin"

Antworte im folgenden JSON-Format:
{
  "lösung": "Die richtige Antwort lautet: [Liste der richtigen Optionen].",
  "erklärung": "[Allgemeine Einführung]. Erläuterung der richtigen Antwort(en): [Warum jede richtige Option richtig ist]. Warum die anderen Optionen nicht korrekt sind: [Warum jede falsche Option falsch ist].",
  "eselsbrücke": "Eselsbrücke hier oder leer lassen wenn nicht sinnvoll",
  "referenz": "Passende Quelle/Lehrbuch/Leitlinie"
}`;

  let text = '';
  
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    text = response.text();
    
    // Try to extract JSON from the response
    let jsonText = text.trim();
    
    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/gm, '').replace(/```$/gm, '');
    }
    
    // Try to find JSON object in the text
    const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonText = jsonMatch[0];
    }
    
    const parsed = JSON.parse(jsonText);
    
    // Behalte die bestehende Antwort (back) bei
    // Die Lösung kann die bestehende Antwort sein oder eine neue, falls back leer ist
    const lösung = parsed.lösung || parsed.loesung || parsed.antwort || (back || '');
    
    return {
      front,
      back: back || '', // Behalte die bestehende Antwort bei (auch wenn leer)
      lösung: lösung,
      erklärung: parsed.erklärung || parsed.erklarung || '',
      eselsbrücke: parsed.eselsbrücke || parsed.eselsbrucke || '',
      referenz: parsed.referenz || '',
    };
  } catch (error: any) {
    // Better error handling - log the actual error
    console.error(`Gemini API Error: ${error.message}`);
    if (text) {
      console.error(`Response text (first 500 chars): ${text.substring(0, 500)}`);
    }
    
    // Fallback if JSON parsing fails - use the raw text if we got it
    const fallbackText = text || `Fehler bei der Generierung: ${error.message}`;
    
    return {
      front,
      back: back || '', // Behalte die bestehende Antwort bei
      lösung: back || '',
      erklärung: fallbackText,
      eselsbrücke: '',
      referenz: '',
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
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<EnrichedCard[]> {
  const enriched: EnrichedCard[] = [];
  
  // Process cards with a small delay to respect rate limits
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    
    try {
      const enrichedCard = await enrichCard(
        card.front, 
        card.back, 
        apiKey,
        card.options,
        card.answers
      );
      enriched.push(enrichedCard);
      
      if (onProgress) {
        onProgress(i + 1, cards.length);
      }
      
      // Small delay to avoid rate limits (Gemini free tier is generous, but be nice)
      if (i < cards.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
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
      });
    }
  }
  
  return enriched;
}
