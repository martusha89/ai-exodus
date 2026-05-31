#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from '../src/parser.js';
import { analyze } from '../src/analyzer.js';
import { generate } from '../src/generator.js';
import { checkProvider, resetConfigCache } from '../src/ai.js';
import { deploy } from '../src/deploy.js';
import { importExport } from '../src/import.js';
import { loadConfig, setConfig } from '../src/config.js';
import { Checkpoint } from '../src/checkpoint.js';

const VERSION = '2.1.0';

const HELP = `
  ai-exodus v${VERSION}
  Migrate your AI relationship from any platform to Claude.

  Usage:
    ai-exodus deploy                           Deploy your personal portal
    ai-exodus import <export-file> [options]   Import chat history to portal
    ai-exodus analyze [options]                Analyze imported data (from portal)
    ai-exodus migrate <export-file> [options]  Classic: parse + analyze + generate locally
    ai-exodus formats                          Show supported export formats
    ai-exodus config                           Show current configuration
    ai-exodus --help                           Show this help

  Deploy options:
    --verbose, -v           Show detailed output

  Import options:
    --format, -f <format>   Source format: chatgpt, raw (default: auto-detect)
    --from <date>           Only conversations from this date (YYYY-MM-DD)
    --to <date>             Only conversations up to this date (YYYY-MM-DD)
    --min-messages <n>      Skip conversations shorter than n messages (default: 10)
    --only-models <m,...>   Only include convos using these GPT models
    --portal-url <url>      Portal URL (default: from config)
    --password <pw>         Portal password
    --verbose, -v           Show detailed progress

  Analyze options:
    --passes <list>         Which passes to run: index,persona,memory,skills,relationship,all (default: all)
    --provider <name>       Analysis engine: claude (default) or gemini (free API)
    --model <model>         Claude model (default: sonnet). Ignored for gemini.
    --fast                  Use the cheaper/faster model for indexing & skills passes
    --from <date>           Only analyze conversations from this date
    --to <date>             Only analyze conversations up to this date
    --only-models <m,...>   Only analyze convos using these models
    --name <name>           Your AI's name
    --user <name>           Your name
    --nsfw                  Include NSFW content
    --portal-url <url>      Portal URL (default: from config)
    --password <pw>         Portal password
    --output, -o <dir>      Also write local files (default: portal only)
    --retry-skipped         Force-retry ALL previously-skipped chunks (default: only context-too-big skips auto-retry on resume)
    --verbose, -v           Show detailed progress

  Migrate options (classic local mode):
    --output, -o <dir>      Output directory (default: ./exodus-output)
    --format, -f <format>   Source format: chatgpt, raw (default: auto-detect)
    --hearthline            Include Hearthline-ready package
    --letta                 Include Letta (MemGPT) memory import package
    --nsfw                  Include NSFW/intimate content in output
    --name <name>           Your AI's name
    --user <name>           Your name
    --from <date>           Only conversations from this date (YYYY-MM-DD)
    --to <date>             Only conversations up to this date (YYYY-MM-DD)
    --min-messages <n>      Skip conversations shorter than n messages (default: 10)
    --only-models <m,...>   Only include convos using these GPT models
    --fast                  Use the cheaper/faster model for indexing & skills
    --provider <name>       Analysis engine: claude (default) or gemini (free API)
    --model <model>         Claude model to use (default: sonnet). Ignored for gemini.
    --verbose, -v           Show detailed progress
    --help, -h              Show this help
    --version               Show version

  Analysis engine (pick one):
    claude  (default)  Claude Code CLI, runs on your subscription, no API key.
                       Install: npm install -g @anthropic-ai/claude-code
    gemini  (free)     Google Gemini free tier. No subscription needed.
                       Get a free key: https://aistudio.google.com/apikey
                       Then:  ai-exodus config set gemini-key <KEY>
                       And run with:  --provider gemini

  Examples:
    ai-exodus deploy
    ai-exodus import conversations.json
    ai-exodus config set gemini-key AIza...        # use the free engine
    ai-exodus analyze --provider gemini --passes persona,memory
    ai-exodus analyze --passes persona,memory --model sonnet --from 2024-06
    ai-exodus migrate export.json --provider gemini --name "Cass" --user "Marta"
    ai-exodus migrate export.json --from 2025-06-01 --to 2025-12-31
`;

const FORMATS = `
  Supported Export Formats:

  chatgpt     ChatGPT JSON export (Settings > Data Controls > Export Data)
              File: conversations.json inside the ZIP
              Richest data — full history, timestamps, model info

  claude      Claude.ai data export (Settings > Privacy > Export Data)
              File: conversations.json (chat_messages with human/assistant)

  generic     ANY other chat-export JSON — Grok, Gemini, Character.AI, Replika,
              or unknown tools. Sniffs role + content fields automatically.
              Also reads JSONL (one JSON object per line).
              Aliases: --format grok, --format gemini

  raw         Plain text conversation logs (TXT, MD)
              Copy-pasted transcripts, any platform
              Less metadata but still extracts personality + memory

  Format is auto-detected from the file. Override with --format <name> if a
  generic export is mis-detected.
`;

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  if (args.includes('--version')) {
    console.log(VERSION);
    process.exit(0);
  }

  const command = args[0];

  if (command === 'formats') {
    console.log(FORMATS);
    process.exit(0);
  }

  // ── Deploy ──
  if (command === 'deploy') {
    const { values: deployVals } = parseArgs({
      args: args.slice(1),
      options: { verbose: { type: 'boolean', short: 'v', default: false } },
      allowPositionals: true,
    });
    await deploy({ verbose: deployVals.verbose });
    process.exit(0);
  }

  // ── Import ──
  if (command === 'import') {
    const { values: importVals, positionals: importPos } = parseArgs({
      args: args.slice(1),
      options: {
        format:         { type: 'string', short: 'f' },
        from:           { type: 'string' },
        to:             { type: 'string' },
        'min-messages': { type: 'string', default: '10' },
        'only-models':  { type: 'string' },
        'portal-url':   { type: 'string' },
        password:       { type: 'string' },
        verbose:        { type: 'boolean', short: 'v', default: false },
      },
      allowPositionals: true,
    });
    const inputFile = importPos[0];
    if (!inputFile) {
      console.error('Error: No input file specified.\nUsage: ai-exodus import <export-file>');
      process.exit(1);
    }
    await importExport(inputFile, {
      format: importVals.format,
      verbose: importVals.verbose,
      from: importVals.from,
      to: importVals.to,
      minMessages: importVals['min-messages'],
      modelFilter: importVals['only-models'] ? importVals['only-models'].split(',').map(s => s.trim()) : null,
      portalUrl: importVals['portal-url'],
      password: importVals.password,
    });
    process.exit(0);
  }

  // ── Analyze (portal mode) ──
  if (command === 'analyze') {
    const { values: analyzeVals } = parseArgs({
      args: args.slice(1),
      options: {
        passes:         { type: 'string', default: 'all' },
        provider:       { type: 'string' },
        model:          { type: 'string', default: 'sonnet' },
        fast:           { type: 'boolean', default: false },
        from:           { type: 'string' },
        to:             { type: 'string' },
        'only-models':  { type: 'string' },
        name:           { type: 'string' },
        user:           { type: 'string' },
        nsfw:           { type: 'boolean', default: false },
        'portal-url':   { type: 'string' },
        password:       { type: 'string' },
        output:         { type: 'string', short: 'o' },
        'retry-skipped': { type: 'boolean', default: false },
        verbose:        { type: 'boolean', short: 'v', default: false },
      },
      allowPositionals: true,
    });

    // Determine which passes to run
    const passMap = { index: 1, persona: 2, personality: 2, memory: 3, skills: 4, relationship: 5 };
    let selectedPasses;
    if (analyzeVals.passes === 'all') {
      selectedPasses = [1, 2, 3, 4, 5];
    } else {
      selectedPasses = [...new Set(
        analyzeVals.passes.split(',').map(p => passMap[p.trim().toLowerCase()]).filter(Boolean)
      )].sort();
      // Index (pass 1) is always required as dependency
      if (!selectedPasses.includes(1)) selectedPasses.unshift(1);
    }

    const config = await loadConfig();
    const portalUrl = analyzeVals['portal-url'] || config.portalUrl;

    // Resolve provider (flag wins; router falls back to config/env/auto)
    if (analyzeVals.provider) { process.env.EXODUS_PROVIDER = analyzeVals.provider; resetConfigCache(); }
    const pre = await checkProvider();
    if (!pre.ok) {
      console.error('  Error: ' + pre.error);
      process.exit(1);
    }

    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║       AI EXODUS — Analyze Data       ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log('  Passes:  ' + selectedPasses.map(p => ['Index','Personality','Memory','Skills','Relationship'][p-1]).join(', '));
    console.log('  Engine:  ' + (pre.provider === 'gemini' ? 'Gemini (free API)' : 'Claude CLI'));
    console.log('  Model:   ' + analyzeVals.model);
    if (analyzeVals.fast) console.log('  Fast:    yes (Haiku for indexing & skills)');
    if (portalUrl) console.log('  Portal:  ' + portalUrl);
    if (analyzeVals.from || analyzeVals.to) console.log('  Dates:   ' + (analyzeVals.from || 'start') + ' -> ' + (analyzeVals.to || 'end'));
    console.log('');

    // If portal is configured, fetch conversations from it
    let parsed;
    if (portalUrl) {
      console.log('  Fetching conversations from portal...');
      let cookie = '';
      const password = analyzeVals.password || config.portalPassword;
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

      // Fetch all conversations
      let allConvos = [];
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        let qs = `conversations?page=${page}&limit=100`;
        if (analyzeVals.from) qs += '&from=' + analyzeVals.from;
        if (analyzeVals.to) qs += '&to=' + analyzeVals.to;
        // Note: portal API only filters by single model — fetch broadly, filter locally
        // if (analyzeVals['only-models']) qs += '&model=' + ...;

        const res = await fetch(portalUrl + '/api/' + qs, {
          headers: cookie ? { Cookie: cookie } : {},
        });
        if (!res.ok) {
          const errText = await res.text().catch(() => '');
          console.error('  Error fetching conversations: HTTP ' + res.status);
          if (res.status === 401) console.error('  Check your password (--password flag or ~/.exodus/config.json)');
          console.error('  ' + errText.slice(0, 200));
          process.exit(1);
        }
        const data = await res.json();
        if (!data.conversations?.length) { hasMore = false; break; }
        allConvos.push(...data.conversations);
        hasMore = page < data.pages;
        page++;
      }

      console.log('  Found ' + allConvos.length + ' conversations');

      // Fetch messages for each conversation
      console.log('  Fetching message content...');
      const conversations = [];
      for (let i = 0; i < allConvos.length; i++) {
        const convo = allConvos[i];
        process.stdout.write(`\r    ${i + 1}/${allConvos.length}...`);
        // Paginate through all messages
        let allMessages = [];
        let msgPage = 1;
        let msgHasMore = true;
        while (msgHasMore) {
          const msgRes = await fetch(portalUrl + '/api/conversations/' + convo.id + '/messages?limit=500&page=' + msgPage, {
            headers: cookie ? { Cookie: cookie } : {},
          });
          const msgData = await msgRes.json();
          if (!msgData.messages?.length) { msgHasMore = false; break; }
          allMessages.push(...msgData.messages);
          msgHasMore = allMessages.length < msgData.total;
          msgPage++;
        }
        const msgData = { messages: allMessages };
        conversations.push({
          id: convo.id,
          title: convo.title,
          createdAt: convo.created_at ? new Date(convo.created_at) : null,
          updatedAt: convo.updated_at ? new Date(convo.updated_at) : null,
          model: convo.model,
          messageCount: msgData.messages?.length || 0,
          messages: (msgData.messages || []).map(m => ({
            role: m.role,
            content: m.content,
            model: m.model,
            timestamp: m.created_at ? new Date(m.created_at) : null,
          })),
        });
      }
      console.log('');

      // Local model filter (portal API only supports single model filter)
      let filtered = conversations;
      if (analyzeVals['only-models']) {
        const modelFilters = analyzeVals['only-models'].split(',').map(m => m.trim().toLowerCase());
        filtered = conversations.filter(c => {
          const convoModels = c.messages.map(m => (m.model || '').toLowerCase()).filter(Boolean);
          return convoModels.some(cm => modelFilters.some(f => cm.includes(f)));
        });
        console.log('  Model filter: ' + filtered.length + '/' + conversations.length + ' conversations match');
      }

      const totalMsgs = filtered.reduce((sum, c) => sum + c.messageCount, 0);
      const dates = filtered.map(c => c.createdAt).filter(Boolean).sort();
      parsed = {
        source: 'portal',
        conversations: filtered,
        messageCount: totalMsgs,
        dateRange: { from: dates[0] || 'unknown', to: dates[dates.length - 1] || 'unknown' },
      };
    } else {
      console.error('  Error: No portal URL. Run `ai-exodus deploy` first, or use --portal-url <url>');
      process.exit(1);
    }

    console.log('  Starting analysis...');
    console.log('');

    const outputDir = resolve(analyzeVals.output || './exodus-output');
    const analysis = await analyze(parsed, {
      outputDir,
      model: analyzeVals.model,
      fast: analyzeVals.fast,
      aiName: analyzeVals.name,
      userName: analyzeVals.user,
      includeNsfw: analyzeVals.nsfw,
      verbose: analyzeVals.verbose,
      selectedPasses,
      retrySkipped: analyzeVals['retry-skipped'],
      clearCheckpoint: false, // keep checkpoint until the portal push is confirmed below
    });

    // Push results to portal
    if (portalUrl) {
      console.log('');
      console.log('  Pushing results to portal...');
      let pushOk = true; // becomes false on any failed artifact; gates checkpoint clear
      let cookie = '';
      const password = analyzeVals.password || config.portalPassword;
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

      // Push analysis results in chunks to avoid Worker timeout
      const allMemories = flattenMemories(analysis.memory);
      const allSkills = analysis.skills?.skills || [];
      const CHUNK = 500; // memories per request

      // 1. Skills + persona + narrative (small, one request)
      console.log('  Pushing skills, persona, narrative...');
      const metaRes = await fetch(portalUrl + '/api/import/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({
          skills: allSkills,
          memories: [],
          persona: analysis.persona || '',
          narrative: analysis.relationship || '',
          stats: analysis.stats,
        }),
      });
      if (!metaRes.ok) {
        const errData = await metaRes.json().catch(() => ({}));
        console.error('  Warning: Failed to push skills/persona: ' + (errData.error || `HTTP ${metaRes.status}`));
        pushOk = false;
      } else {
        console.log('    ' + allSkills.length + ' skills, persona, narrative pushed.');
      }

      // 2. Memories in chunks
      if (allMemories.length > 0) {
        console.log('  Pushing ' + allMemories.length + ' memories...');
        for (let i = 0; i < allMemories.length; i += CHUNK) {
          const chunk = allMemories.slice(i, i + CHUNK);
          const memRes = await fetch(portalUrl + '/api/import/analysis', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
            body: JSON.stringify({ skills: [], memories: chunk }),
          });
          if (!memRes.ok) {
            console.error('    Warning: Memory chunk ' + (i / CHUNK + 1) + ' failed');
            pushOk = false;
          } else {
            process.stdout.write('\r    ' + Math.min(i + CHUNK, allMemories.length) + '/' + allMemories.length + ' memories pushed');
          }
        }
        console.log('');
      }

      // Only now that the push is confirmed do we clear the checkpoint. If any
      // artifact failed, the on-disk checkpoint stays so a re-run can recover.
      if (pushOk) {
        await new Checkpoint(outputDir).clear();
        console.log('  Results pushed to portal.');
      } else {
        console.log('  Results pushed with errors — checkpoint KEPT at ' + outputDir);
        console.log('  Re-run the same analyze command to retry the failed parts.');
      }
    }

    // Also write local files if --output was specified
    if (analyzeVals.output) {
      console.log('  Writing local files to ' + outputDir + '...');
      await generate(analysis, {
        outputDir,
        hearthline: false,
        letta: false,
        aiName: analyzeVals.name || analysis.personality?.name || 'AI',
        userName: analyzeVals.user || analysis.memory?.userName || 'User',
      });
    }

    console.log('');
    console.log('  Analysis complete!');
    if (portalUrl) console.log('  View results at: ' + portalUrl);
    console.log('');
    process.exit(0);
  }

  // ── Config ──
  if (command === 'config') {
    // `ai-exodus config set <key> <value>`
    if (args[1] === 'set') {
      const friendly = {
        provider:           'provider',          // claude | gemini
        'gemini-key':       'geminiApiKey',
        'gemini-model':     'geminiModel',
        'gemini-model-fast':'geminiModelFast',
        'gemini-temp':      'geminiTemperature',
        'gemini-max-tokens':'geminiMaxTokens',
      };
      const rawKey = args[2];
      const value = args[3];
      const realKey = friendly[rawKey];
      if (!realKey || value === undefined) {
        console.error('  Usage: ai-exodus config set <key> <value>');
        console.error('  Keys: ' + Object.keys(friendly).join(', '));
        process.exit(1);
      }
      let stored = value;
      if (realKey === 'geminiTemperature') stored = parseFloat(value);
      if (realKey === 'geminiMaxTokens') stored = parseInt(value, 10);
      await setConfig(realKey, stored);
      const shown = rawKey === 'gemini-key' ? value.slice(0, 6) + '…(saved)' : stored;
      console.log(`  Saved: ${rawKey} = ${shown}`);
      process.exit(0);
    }

    const config = await loadConfig();
    console.log('');
    console.log('  AI Exodus Configuration');
    console.log('  ─────────────────────────');
    if (config.portalUrl) console.log('  Portal URL:  ' + config.portalUrl);
    if (config.deployName) console.log('  Deploy name: ' + config.deployName);
    if (config.dbName) console.log('  Database:    ' + config.dbName);
    if (config.mcpSecret) console.log('  MCP Secret:  ' + config.mcpSecret);
    console.log('  ─── Analysis engine ───');
    const envProvider = process.env.EXODUS_PROVIDER;
    const autoGemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || config.geminiApiKey);
    const activeProvider = (envProvider || config.provider || (autoGemini ? 'gemini' : 'claude')).toLowerCase();
    console.log('  Provider:    ' + activeProvider + (config.provider ? '' : ' (auto)'));
    if (activeProvider === 'gemini') {
      console.log('  Gemini key:  ' + (config.geminiApiKey ? 'set (config)' : (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) ? 'set (env)' : 'NOT SET'));
      console.log('  Gemini model:' + (config.geminiModel || 'gemini-2.0-flash') + ' / ' + (config.geminiModelFast || 'gemini-2.0-flash-lite'));
    }
    if (!config.portalUrl) console.log('  No deployment found. Run: ai-exodus deploy');
    console.log('');
    process.exit(0);
  }

  if (command !== 'migrate') {
    console.error(`Unknown command: ${command}\nRun ai-exodus --help for usage.`);
    process.exit(1);
  }

  // Parse options
  const { values, positionals } = parseArgs({
    args: args.slice(1),
    options: {
      output:         { type: 'string', short: 'o', default: './exodus-output' },
      format:         { type: 'string', short: 'f' },
      hearthline:     { type: 'boolean', default: false },
      letta:          { type: 'boolean', default: false },
      nsfw:           { type: 'boolean', default: false },
      name:           { type: 'string' },
      user:           { type: 'string' },
      from:           { type: 'string' },
      to:             { type: 'string' },
      'min-messages': { type: 'string', default: '10' },
      'only-models':  { type: 'string' },
      fast:           { type: 'boolean', default: false },
      provider:       { type: 'string' },
      model:          { type: 'string', default: 'sonnet' },
      verbose:        { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
  });

  const inputFile = positionals[0];
  if (!inputFile) {
    console.error('Error: No input file specified.\nUsage: ai-exodus migrate <export-file>');
    process.exit(1);
  }

  // Expand ~ to home directory (Windows doesn't do this natively)
  const expanded = inputFile.startsWith('~')
    ? inputFile.replace(/^~/, process.env.HOME || process.env.USERPROFILE)
    : inputFile;
  const inputPath = resolve(expanded);
  if (!existsSync(inputPath)) {
    console.error(`Error: File not found: ${inputPath}`);
    process.exit(1);
  }

  // Resolve provider and preflight (Claude CLI or Gemini key)
  if (values.provider) { process.env.EXODUS_PROVIDER = values.provider; resetConfigCache(); }
  const pre = await checkProvider();
  if (!pre.ok) {
    console.error('  Error: ' + pre.error);
    process.exit(1);
  }

  const fileSize = statSync(inputPath).size;
  const fileMB = (fileSize / 1024 / 1024).toFixed(1);

  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║           🚚  AI EXODUS  🚚          ║');
  console.log('  ║   Your AI belongs to you. Let\'s go.  ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log(`  Input:    ${basename(inputPath)} (${fileMB} MB)`);
  console.log(`  Format:   ${values.format || 'auto-detect'}`);
  console.log(`  Output:   ${resolve(values.output)}`);
  console.log(`  Engine:   ${pre.provider === 'gemini' ? 'Gemini (free API)' : 'Claude CLI'}`);
  if (values.name) console.log(`  AI Name:  ${values.name}`);
  if (values.user) console.log(`  User:     ${values.user}`);
  console.log(`  Model:    ${values.model}`);
  console.log(`  NSFW:     ${values.nsfw ? 'included' : 'excluded'}`);
  if (values.from || values.to) console.log(`  Dates:    ${values.from || 'start'} → ${values.to || 'end'}`);
  if (values['only-models']) console.log(`  Models:   ${values['only-models']}`);
  console.log(`  Min msgs: ${values['min-messages']}`);
  console.log(`  Hearthline: ${values.hearthline ? 'yes' : 'no'}`);
  console.log(`  Letta:    ${values.letta ? 'yes' : 'no'}`);
  if (values.fast) console.log(`  Fast:     yes (Haiku for indexing & skills)`);
  console.log('');

  // Parse date filters
  const fromDate = values.from ? new Date(values.from + 'T00:00:00') : null;
  const toDate = values.to ? new Date(values.to + 'T23:59:59') : null;
  const minMessages = parseInt(values['min-messages'], 10) || 10;

  try {
    // Step 1: Parse
    console.log('  ▸ Parsing export data...');
    const modelFilter = values['only-models']
      ? values['only-models'].split(',').map(s => s.trim())
      : null;

    const parsed = await parse(inputPath, {
      format: values.format,
      verbose: values.verbose,
      minMessages,
      from: fromDate,
      to: toDate,
      modelFilter,
    });
    console.log(`    Found ${parsed.conversations.length} conversations, ${parsed.messageCount} messages`);
    console.log(`    Date range: ${parsed.dateRange.from} → ${parsed.dateRange.to}`);
    console.log('');

    // Step 2: Analyze (5 passes)
    console.log('  ▸ Analyzing your AI relationship...');
    console.log('    This takes a while. Go make a coffee — your AI is being reconstructed.');
    console.log('');
    const analysis = await analyze(parsed, {
      outputDir: resolve(values.output),
      model: values.model,
      fast: values.fast,
      aiName: values.name,
      userName: values.user,
      includeNsfw: values.nsfw,
      verbose: values.verbose,
      clearCheckpoint: false, // keep checkpoint until output files are written below
    });

    // Step 3: Generate output
    console.log('');
    console.log('  ▸ Generating migration package...');
    const outputPath = await generate(analysis, {
      outputDir: resolve(values.output),
      hearthline: values.hearthline,
      letta: values.letta,
      aiName: values.name || analysis.personality.name || 'AI',
      userName: values.user || analysis.memory.userName || 'User',
    });

    // Output written successfully — safe to clear the checkpoint now.
    await new Checkpoint(resolve(values.output)).clear();

    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║          Migration complete.          ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  Your AI has been reconstructed at:`);
    console.log(`  ${outputPath}`);
    console.log('');
    console.log('  Files:');
    console.log('    custom-instructions.txt — Paste into Claude.ai (short, dense)');
    console.log('    persona.md              — Full personality definition');
    console.log('    claude.md               — Ready-to-use CLAUDE.md');
    console.log('    memory/                 — Everything they knew about you');
    console.log('    skills/                 — What they could do');
    console.log('    preferences.md          — How you like to communicate');
    console.log('    relationship.md         — Your story together');
    if (values.hearthline) {
      console.log('    hearthline/             — Drop into Hearthline deploy');
    }
    if (values.letta) {
      console.log('    letta/                  — Letta memory import package');
    }
    console.log('');
    console.log('  Read relationship.md first. That\'s the one that matters.');
    console.log('');

  } catch (err) {
    console.error(`\n  Error: ${err.message}`);
    if (values.verbose && err.stack) console.error(err.stack);
    process.exit(1);
  }
}

/**
 * Flatten nested memory object into array of {category, key, value} for portal import
 */
function flattenMemories(memory) {
  if (!memory) return [];
  const entries = [];

  function extract(obj, category) {
    if (!obj) return;
    for (const [key, val] of Object.entries(obj)) {
      if (!val || val === 'if known' || val === 'if mentioned') continue;
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'string') {
            entries.push({ category, key, value: item });
          } else if (item && typeof item === 'object') {
            // Timeline events etc
            entries.push({ category, key, value: JSON.stringify(item) });
          }
        }
      } else if (typeof val === 'string' && val.length > 0) {
        entries.push({ category, key, value: val });
      } else if (typeof val === 'object') {
        extract(val, category);
      }
    }
  }

  if (memory.identity) extract(memory.identity, 'identity');
  if (memory.life) extract(memory.life, 'life');
  if (memory.preferences) extract(memory.preferences, 'preferences');
  if (memory.personality) extract(memory.personality, 'personality');
  if (memory.relationship) extract(memory.relationship, 'relationship');
  if (memory.timeline) {
    for (const evt of memory.timeline) {
      entries.push({ category: 'timeline', key: evt.date || '', value: evt.event || JSON.stringify(evt) });
    }
  }
  if (memory.rawFacts) {
    for (const fact of memory.rawFacts) {
      entries.push({ category: 'facts', key: null, value: fact });
    }
  }

  return entries;
}

main();
