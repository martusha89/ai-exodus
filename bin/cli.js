#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { resolve, basename } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse } from '../src/parser.js';
import { analyze } from '../src/analyzer.js';
import { generate } from '../src/generator.js';
import { checkCLI } from '../src/claude.js';

const VERSION = '1.0.0';

const HELP = `
  ai-exodus v${VERSION}
  Migrate your AI relationship from any platform to Claude.

  Usage:
    ai-exodus migrate <export-file> [options]
    ai-exodus formats                          Show supported export formats
    ai-exodus --help                           Show this help

  Options:
    --output, -o <dir>      Output directory (default: ./exodus-output)
    --format, -f <format>   Source format: chatgpt, raw (default: auto-detect)
    --hearthline            Include Hearthline-ready package
    --letta                 Include Letta (MemGPT) memory import package
    --nsfw                  Include NSFW/intimate content in output
    --name <name>           Your AI's name (helps extraction accuracy)
    --user <name>           Your name (helps extraction accuracy)
    --from <date>           Only include conversations from this date (YYYY-MM-DD)
    --to <date>             Only include conversations up to this date (YYYY-MM-DD)
    --min-messages <n>      Skip conversations shorter than n messages (default: 10)
    --only-models <m,...>   Only include convos using these GPT models (e.g. gpt-4o,gpt-4.1)
    --fast                  Use Haiku for indexing & skills passes (saves ~30% tokens)
    --model <model>         Claude model to use (default: sonnet)
    --verbose, -v           Show detailed progress
    --help, -h              Show this help
    --version               Show version

  Requires:
    Claude Code CLI installed and logged in (runs on your subscription, no API key needed)
    Install: npm install -g @anthropic-ai/claude-code

  Examples:
    ai-exodus migrate conversations.json
    ai-exodus migrate export.json --name "Cass" --user "Marta" --hearthline
    ai-exodus migrate chatlog.txt --format raw --output ./my-ai
    ai-exodus migrate export.json --from 2025-06-01 --to 2025-12-31
    ai-exodus migrate export.json --letta --min-messages 20
`;

const FORMATS = `
  Supported Export Formats:

  chatgpt     ChatGPT JSON export (Settings > Data Controls > Export Data)
              File: conversations.json inside the ZIP
              Richest data — full history, timestamps, model info

  raw         Plain text conversation logs (TXT, MD)
              Copy-pasted transcripts, any platform
              Less metadata but still extracts personality + memory

  Coming soon:
    cai        Character.AI conversation exports
    replika    Replika GDPR data export
    tavern     SillyTavern JSONL / character cards
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

  // Check Claude CLI is available
  const cli = await checkCLI();
  if (!cli.ok) {
    console.error('Error: Claude Code CLI not found or not responding.');
    console.error('Install it:  npm install -g @anthropic-ai/claude-code');
    console.error('Then log in: claude login');
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

main();
