#!/usr/bin/env node

/**
 * Enrich cards only once - skip cards that already have enrichment
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:3000/api/mcp';
const BATCH_SIZE = 5;
const PROGRESS_FILE = path.join(__dirname, 'enrich-once-progress.json');

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
  }
  return {};
}

function saveProgress(progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

async function apiRequest(endpoint, body = null, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const options = {
        method: body ? 'POST' : 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(180000), // 3 minute timeout
      };
      if (body) {
        options.body = JSON.stringify(body);
      }
      
      const res = await fetch(`${API_BASE}${endpoint}`, options);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
      }
      return res.json();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.log(`   ⚠️  Retry attempt ${attempt}/${retries}...`);
      await new Promise(resolve => setTimeout(resolve, 5000 * attempt));
    }
  }
}

async function checkCardHasEnrichment(deckName, noteId) {
  try {
    const ankiRes = await fetch('http://localhost:8765', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'notesInfo',
        version: 6,
        params: { notes: [noteId] },
      }),
    });
    
    if (!ankiRes.ok) return false;
    
    const data = await ankiRes.json();
    if (!data.result || data.result.length === 0) return false;
    
    const note = data.result[0];
    const fields = note.fields || {};
    
    // Check Extra 1 first, then Sources
    const extra1 = fields['Extra 1']?.value || '';
    const sources = fields['Sources']?.value || '';
    
    const content = extra1 || sources;
    const hasEnrichment = content.includes('Lösung:') || 
                         content.includes('Erklärung:') || 
                         content.includes('Bewertungstabelle') ||
                         content.includes('Zusammenfassung:');
    
    return hasEnrichment;
  } catch {
    return false;
  }
}

async function enrichDeckOnce(deckName) {
  const progress = loadProgress();
  const deckKey = deckName.replace(/[^a-zA-Z0-9]/g, '_');
  const progressKey = `deck_${deckKey}`;
  
  if (!progress[progressKey]) {
    progress[progressKey] = {
      deckName,
      offset: 0,
      total: 0,
      processed: 0,
      skipped: 0,
      updated: 0,
      errors: [],
      startTime: new Date().toISOString(),
    };
  }
  
  const deckProgress = progress[progressKey];
  let offset = deckProgress.offset;
  
  console.log(`\n📚 Deck: ${deckName}`);
  console.log(`📊 Starting at offset: ${offset}`);
  
  // Get total count first
  if (deckProgress.total === 0) {
    const cardsResult = await apiRequest('/get-cards', { deckName });
    deckProgress.total = cardsResult.count;
    saveProgress(progress);
    console.log(`📊 Total cards: ${deckProgress.total}`);
  }
  
  // Get all cards and check enrichment status
  console.log('\n🔍 Checking which cards already have enrichment...');
  const allCards = await apiRequest('/get-cards', { deckName, limit: 1000 });
  const cardsToProcess = [];
  
  for (let i = 0; i < allCards.cards.length; i++) {
    const card = allCards.cards[i];
    if (i < offset) {
      deckProgress.skipped++;
      continue; // Skip already processed
    }
    
    const hasEnrichment = await checkCardHasEnrichment(deckName, card.noteId);
    if (!hasEnrichment) {
      cardsToProcess.push({ ...card, originalIndex: i });
    } else {
      deckProgress.skipped++;
      if (deckProgress.skipped % 10 === 0) {
        console.log(`   ⏭️  ${deckProgress.skipped} cards already enriched...`);
      }
    }
  }
  
  console.log(`\n📊 Cards to process: ${cardsToProcess.length}`);
  console.log(`   Already enriched: ${deckProgress.skipped}`);
  console.log(`   Total: ${deckProgress.total}\n`);
  
  // Process cards in batches using their original indices
  for (let i = 0; i < cardsToProcess.length; i += BATCH_SIZE) {
    const batch = cardsToProcess.slice(i, i + BATCH_SIZE);
    const firstIndex = batch[0].originalIndex;
    
    console.log(`\n🔄 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(cardsToProcess.length / BATCH_SIZE)} (${batch.length} cards, starting at index ${firstIndex})...`);
    
    try {
      // Enrich using the original index as offset
      const enrichResult = await apiRequest('/enrich-cards', {
        deckName,
        limit: BATCH_SIZE,
        offset: firstIndex,
      });
      
      const nextOffset = typeof enrichResult.nextOffset === 'number'
        ? enrichResult.nextOffset
        : firstIndex + BATCH_SIZE;

      if (!enrichResult.success || !enrichResult.enriched || enrichResult.enriched.length === 0) {
        console.log(`   ⚠️  No cards enriched in this batch`);
        // Update offset to skip this batch
        deckProgress.offset = nextOffset;
        saveProgress(progress);
        continue;
      }
      
      console.log(`   ✅ Enriched ${enrichResult.enriched.length} cards`);
      
      // Sync to Anki
      const syncResult = await apiRequest('/sync-to-anki', {
        deckName,
        cards: enrichResult.enriched,
      });
      
      console.log(`   ✅ Synced ${syncResult.updated} cards to Anki`);
      
      deckProgress.offset = nextOffset;
      deckProgress.processed += batch.length;
      deckProgress.updated += syncResult.updated || enrichResult.enriched.length;
      deckProgress.lastUpdate = new Date().toISOString();
      saveProgress(progress);
      
      // Delay to avoid rate limits
      if (i + BATCH_SIZE < cardsToProcess.length) {
        console.log('   ⏳ Waiting 2 seconds before next batch...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
      deckProgress.errors.push({
        offset: firstIndex,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
      deckProgress.offset = firstIndex + BATCH_SIZE;
      saveProgress(progress);
      
      // Wait a bit longer on error
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  deckProgress.endTime = new Date().toISOString();
  saveProgress(progress);
  
  console.log(`\n🎉 Completed!`);
  console.log(`   Processed: ${deckProgress.processed}/${deckProgress.total}`);
  console.log(`   Skipped (already enriched): ${deckProgress.skipped}`);
  console.log(`   Updated: ${deckProgress.updated}`);
  console.log(`   Errors: ${deckProgress.errors.length}`);
}

async function main() {
  const deckName = process.argv[2];
  
  if (!deckName) {
    console.error('Usage: node enrich-once.js "<deck name>"');
    console.error('\nExample:');
    console.error('  node enrich-once.js "TUD Klinik::9. Semester::Altfragen Schmerzmedizin"');
    process.exit(1);
  }
  
  console.log(`🚀 Starting one-time enrichment for: ${deckName}`);
  console.log(`💾 Progress will be saved to: ${PROGRESS_FILE}`);
  console.log(`\n⚠️  Note: Cards with existing enrichment will be skipped\n`);
  
  try {
    await enrichDeckOnce(deckName);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
