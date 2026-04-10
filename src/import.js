/**
 * Import command — parses chat export and pushes to portal
 * Reads the export file, extracts conversations + messages,
 * then POSTs them in batches to the portal's import API
 */

import { resolve, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from './parser.js';
import { loadConfig } from './config.js';
import { Spinner } from './spinner.js';

const BATCH_SIZE = 10; // conversations per batch
const MAX_RETRIES = 3; // max retries per batch

export async function importExport(inputFile, options) {
  const { format, verbose, from, to, minMessages, modelFilter } = options;

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       AI EXODUS — Import Data        ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');

  // Load config for portal URL
  const config = await loadConfig();
  const portalUrl = options.portalUrl || config.portalUrl;
  const password = options.password || config.portalPassword;

  if (!portalUrl) {
    console.error('  Error: No portal URL configured.');
    console.error('  Run `ai-exodus deploy` first, or use --portal-url <url>');
    process.exit(1);
  }

  // Resolve input file
  const expanded = inputFile.startsWith('~')
    ? inputFile.replace(/^~/, process.env.HOME || process.env.USERPROFILE)
    : inputFile;
  const inputPath = resolve(expanded);
  if (!existsSync(inputPath)) {
    console.error('  Error: File not found: ' + inputPath);
    process.exit(1);
  }

  const fileStat = statSync(inputPath);
  const isDir = fileStat.isDirectory();
  const fileMB = isDir ? '(directory)' : (fileStat.size / 1024 / 1024).toFixed(1) + ' MB';

  console.log('  Portal:   ' + portalUrl);
  console.log('  Input:    ' + basename(inputPath) + ' (' + fileMB + ')');
  console.log('  Format:   ' + (format || 'auto-detect'));
  if (from || to) console.log('  Dates:    ' + (from || 'start') + ' -> ' + (to || 'end'));
  if (modelFilter) console.log('  Models:   ' + modelFilter.join(', '));
  console.log('');

  // Parse date filters
  const fromDate = from ? new Date(from + 'T00:00:00') : null;
  const toDate = to ? new Date(to + 'T23:59:59') : null;
  const minMsgs = parseInt(minMessages, 10) || 10;

  // Step 1: Parse the export
  console.log('  [1/2] Parsing export...');
  const parsed = await parse(inputPath, {
    format,
    verbose,
    minMessages: minMsgs,
    from: fromDate,
    to: toDate,
    modelFilter,
  });

  console.log('    Found ' + parsed.conversations.length + ' conversations, ' + parsed.messageCount + ' messages');
  console.log('    Date range: ' + parsed.dateRange.from + ' -> ' + parsed.dateRange.to);
  console.log('');

  // Step 2: Push to portal in batches
  console.log('  [2/2] Importing to portal...');

  // Get auth cookie
  let cookie = '';
  if (password) {
    const loginRes = await fetch(portalUrl + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    if (loginRes.ok) {
      const setCookie = loginRes.headers.get('set-cookie') || '';
      cookie = setCookie.split(';')[0];
    }
  }

  const spinner = new Spinner();
  let imported = 0;
  let skipped = 0;
  const total = parsed.conversations.length;
  const retryCount = {}; // track retries per batch index

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batchIdx = Math.floor(i / BATCH_SIZE);
    const batch = parsed.conversations.slice(i, i + BATCH_SIZE);
    spinner.start(`Batch ${batchIdx + 1}/${Math.ceil(total / BATCH_SIZE)} (${imported}/${total} conversations)`);

    // Format conversations for the portal API
    const formatted = batch.map(convo => ({
      id: convo.id || crypto.randomUUID(),
      title: convo.title || 'Untitled',
      createdAt: convo.createdAt || convo.messages?.[0]?.createdAt || null,
      updatedAt: convo.updatedAt || convo.messages?.[convo.messages.length - 1]?.createdAt || null,
      model: convo.model || detectModel(convo) || null,
      source: parsed.source || 'chatgpt',
      metadata: {
        messageCount: convo.messageCount || convo.messages?.length || 0,
      },
      messages: (convo.messages || []).map(msg => ({
        role: msg.role || 'user',
        content: msg.content || '',
        model: msg.model || null,
        createdAt: msg.createdAt || msg.timestamp?.toISOString?.() || msg.timestamp || null,
      })),
    }));

    try {
      const res = await fetch(portalUrl + '/api/import/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify({ conversations: formatted }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      imported += batch.length;
      spinner.stop(`${imported}/${total} conversations imported`);
    } catch (err) {
      spinner.fail(`Batch failed: ${err.message}`);
      if (err.message.includes('Unauthorized') || err.message.includes('Setup required')) {
        console.error('');
        console.error('  Auth error. Either:');
        console.error('    1. Set your portal password first (visit ' + portalUrl + ')');
        console.error('    2. Use --password <your-password> flag');
        process.exit(1);
      }
      // Retry with limit
      retryCount[batchIdx] = (retryCount[batchIdx] || 0) + 1;
      if (retryCount[batchIdx] < MAX_RETRIES) {
        console.log(`    Retrying batch (attempt ${retryCount[batchIdx] + 1}/${MAX_RETRIES})...`);
        i -= BATCH_SIZE; // retry
        await new Promise(r => setTimeout(r, 2000 * retryCount[batchIdx])); // exponential backoff
      } else {
        console.log(`    Skipping batch after ${MAX_RETRIES} failures.`);
        skipped += batch.length;
      }
    }
  }

  console.log('');
  console.log('  Import complete!');
  console.log('  ' + imported + ' conversations pushed to ' + portalUrl);
  if (skipped > 0) console.log('  ' + skipped + ' conversations skipped (batch failures)');
  console.log('');
  console.log('  Next: Run analysis on your imported data:');
  console.log('    ai-exodus analyze --passes all');
  console.log('');
}

/**
 * Try to detect the primary model from a conversation's messages
 */
function detectModel(convo) {
  if (!convo.messages?.length) return null;
  const models = {};
  for (const msg of convo.messages) {
    if (msg.model) models[msg.model] = (models[msg.model] || 0) + 1;
  }
  const sorted = Object.entries(models).sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[0] || null;
}
