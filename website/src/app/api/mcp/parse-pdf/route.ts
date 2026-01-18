import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse';
import { buildLlmConfig, generateTextWithFallback } from '@/lib/llmClient';

export const maxDuration = 300; // 5 Minuten für große PDFs

interface ParsedQuestion {
  number: number;
  question: string;
  options: string[];
  type: 'SC' | 'MC' | 'KPRIM';
  correctAnswers?: string; // Binärcode z.B. "10010"
  explanation?: string;
}

interface ParsedExam {
  title: string;
  date?: string;
  questions: ParsedQuestion[];
}

// Extrahiert Text aus PDF
async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const data = await pdf(buffer);
  return data.text;
}

// LLM-Prompt zum Parsen der Fragen
function buildParsePrompt(text: string, batchStart: number, batchEnd: number): string {
  return `Du bist ein Experte für medizinische Prüfungen.

Analysiere den folgenden Klausurtext und extrahiere die Fragen ${batchStart} bis ${batchEnd}.

WICHTIG:
- Extrahiere NUR die Fragen in diesem Bereich
- Erkenne den Fragetyp: SC (eine Antwort), MC (mehrere Antworten), KPRIM (ja/nein pro Option)
- Gib die Optionen exakt wieder

Antworte NUR mit diesem JSON (keine Erklärungen):
{
  "questions": [
    {
      "number": 1,
      "question": "Der vollständige Fragetext...",
      "options": ["Option A Text", "Option B Text", "Option C Text", "Option D Text", "Option E Text"],
      "type": "SC"
    }
  ]
}

KLAUSURTEXT:
${text}`;
}

// LLM-Prompt zum Bestimmen der korrekten Antworten
function buildAnswerPrompt(questions: ParsedQuestion[]): string {
  const questionsText = questions.map((q, i) => {
    const optionsText = q.options.map((opt, j) => `  ${String.fromCharCode(65 + j)}) ${opt}`).join('\n');
    return `Frage ${q.number}: ${q.question}\n${optionsText}`;
  }).join('\n\n');

  return `Du bist ein Experte für Dermatologie und medizinische Prüfungen.

Bestimme die KORREKTEN Antworten für jede Frage. Nutze dein medizinisches Fachwissen.

WICHTIG:
- Bei SC (Single Choice): Genau EINE richtige Antwort
- Bei MC (Multiple Choice): Eine oder mehrere richtige Antworten  
- Gib Antworten als Binärcode (1=richtig, 0=falsch)
- Gib eine KURZE Erklärung warum

Antworte NUR mit diesem JSON:
{
  "answers": [
    {
      "number": 1,
      "correctAnswers": "10000",
      "explanation": "A ist richtig weil... B ist falsch weil..."
    }
  ]
}

FRAGEN:
${questionsText}`;
}

// Parst den extrahierten Text mit LLM
async function parseQuestionsWithLlm(
  text: string, 
  llmConfig: ReturnType<typeof buildLlmConfig>
): Promise<ParsedQuestion[]> {
  // Finde Fragen-Nummern im Text um Batch-Grenzen zu bestimmen
  const questionNumbers = text.match(/^\s*\d+\s*$/gm) || text.match(/^\d+\./gm) || [];
  const totalQuestions = questionNumbers.length || 30; // Fallback
  
  const batchSize = 10;
  const allQuestions: ParsedQuestion[] = [];
  
  for (let start = 1; start <= totalQuestions; start += batchSize) {
    const end = Math.min(start + batchSize - 1, totalQuestions);
    const prompt = buildParsePrompt(text, start, end);
    
    try {
      const response = await generateTextWithFallback(prompt, llmConfig);
      const parsed = extractJson<{ questions: ParsedQuestion[] }>(response);
      if (parsed?.questions) {
        allQuestions.push(...parsed.questions);
      }
    } catch (e) {
      console.error(`Error parsing questions ${start}-${end}:`, e);
    }
  }
  
  return allQuestions;
}

// Bestimmt korrekte Antworten mit LLM
async function determineAnswersWithLlm(
  questions: ParsedQuestion[],
  llmConfig: ReturnType<typeof buildLlmConfig>
): Promise<ParsedQuestion[]> {
  const batchSize = 5;
  const results: ParsedQuestion[] = [...questions];
  
  for (let i = 0; i < questions.length; i += batchSize) {
    const batch = questions.slice(i, i + batchSize);
    const prompt = buildAnswerPrompt(batch);
    
    try {
      const response = await generateTextWithFallback(prompt, llmConfig);
      const parsed = extractJson<{ answers: Array<{ number: number; correctAnswers: string; explanation: string }> }>(response);
      
      if (parsed?.answers) {
        for (const answer of parsed.answers) {
          const idx = results.findIndex(q => q.number === answer.number);
          if (idx !== -1) {
            results[idx].correctAnswers = answer.correctAnswers;
            results[idx].explanation = answer.explanation;
          }
        }
      }
    } catch (e) {
      console.error(`Error determining answers for batch ${i}:`, e);
    }
  }
  
  return results;
}

// JSON aus LLM-Response extrahieren
function extractJson<T>(text: string): T | null {
  try {
    // Markdown Code-Block entfernen
    let jsonText = text.trim();
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/^```(?:json)?\n?/gm, '').replace(/```$/gm, '');
    }
    const match = jsonText.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]) as T;
    }
    return null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const provider = formData.get('provider') as string || 'gemini';
    const model = formData.get('model') as string || '';
    const step = formData.get('step') as string || 'extract'; // 'extract', 'parse', 'answer'
    const questionsJson = formData.get('questions') as string || '';

    if (!file && step === 'extract') {
      return NextResponse.json({ error: 'Keine PDF-Datei hochgeladen' }, { status: 400 });
    }

    const llmConfig = buildLlmConfig({ provider, model: model || undefined });

    // Step 1: Text extrahieren
    if (step === 'extract') {
      const buffer = Buffer.from(await file!.arrayBuffer());
      const text = await extractTextFromPdf(buffer);
      
      // Titel aus erstem Teil extrahieren
      const titleMatch = text.match(/Derma[^\n]*/i) || text.match(/[A-Z][a-z]+\s+WS\s+\d{2}-\d{2}/);
      const dateMatch = text.match(/\d{2}\.\d{2}\.\d{4}/);
      
      return NextResponse.json({
        success: true,
        step: 'extract',
        text: text.substring(0, 50000), // Limit
        title: titleMatch?.[0] || 'Unbekannte Klausur',
        date: dateMatch?.[0] || '',
        charCount: text.length,
      });
    }

    // Step 2: Fragen parsen
    if (step === 'parse') {
      const text = formData.get('text') as string;
      if (!text) {
        return NextResponse.json({ error: 'Kein Text zum Parsen' }, { status: 400 });
      }
      
      const questions = await parseQuestionsWithLlm(text, llmConfig);
      
      return NextResponse.json({
        success: true,
        step: 'parse',
        questions,
        count: questions.length,
      });
    }

    // Step 3: Antworten bestimmen
    if (step === 'answer') {
      if (!questionsJson) {
        return NextResponse.json({ error: 'Keine Fragen zum Beantworten' }, { status: 400 });
      }
      
      const questions: ParsedQuestion[] = JSON.parse(questionsJson);
      const answered = await determineAnswersWithLlm(questions, llmConfig);
      
      return NextResponse.json({
        success: true,
        step: 'answer',
        questions: answered,
        count: answered.length,
      });
    }

    return NextResponse.json({ error: 'Ungültiger Step' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('PDF Parse error:', e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
