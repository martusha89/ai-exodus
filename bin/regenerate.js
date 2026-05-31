#!/usr/bin/env node

/**
 * Regenerate output files from raw-analysis.json
 * Optionally consolidates skills via Claude (one call)
 * Usage: node bin/regenerate.js [--consolidate-skills]
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { generate } from '../src/generator.js';
import { callAI } from '../src/ai.js';

const outputDir = resolve('./exodus-output');

async function main() {
  const consolidate = process.argv.includes('--consolidate-skills');

  console.log('  Loading raw analysis data...');
  const raw = JSON.parse(await readFile(resolve(outputDir, 'raw-analysis.json'), 'utf-8'));

  const aiName = raw.index?.aiName || 'AI';
  const userName = raw.index?.userName || 'User';

  console.log(`  AI: ${aiName} | User: ${userName}`);
  console.log(`  Skills: ${raw.skills?.skills?.length || 0}`);

  let analysis = {
    index: raw.index,
    personality: raw.personality,
    memory: raw.memory,
    skills: raw.skills,
    // These need to be re-read from the existing files
    relationship: await readFile(resolve(outputDir, 'relationship.md'), 'utf-8').catch(() => ''),
    persona: await readFile(resolve(outputDir, 'persona.md'), 'utf-8').catch(() => ''),
    preferences: await readFile(resolve(outputDir, 'preferences.md'), 'utf-8').catch(() => ''),
    customInstructions: await readFile(resolve(outputDir, 'custom-instructions.txt'), 'utf-8')
      .then(t => t.split('──────────────────────────────────────────\n\n')[1] || t)
      .catch(() => ''),
    source: raw.source || 'chatgpt',
    stats: raw.stats || { conversations: 0, messages: 0, dateRange: {}, chunks: 0 },
  };

  if (consolidate && analysis.skills?.skills?.length > 30) {
    const rawCount = analysis.skills.skills.length;
    console.log(`  Consolidating ${rawCount} skills via Claude (one call)...`);

    const result = await callAI({
      model: 'sonnet',
      system: `You are consolidating a list of ${rawCount} extracted skills into a clean, deduplicated list of 15-30 unique skills.

AI: ${aiName}
User: ${userName}

Many skills are duplicates with slightly different names (e.g. "AI image prompt engineering" and "Image generation prompt crafting" are the same skill). Merge them.

Rules:
- Combine duplicates into ONE skill with the best name, description, and examples
- Keep 15-30 unique skills maximum
- Preserve the category, frequency (pick the highest), and approach fields
- Pick the most specific and useful description for each
- primaryRole should be ONE clear sentence
- secondaryRoles should be 3-5 items max
- Output ONLY valid JSON with schema: { "skills": [...], "primaryRole": "...", "secondaryRoles": [...] }
- No markdown fences. No commentary.`,
      prompt: JSON.stringify(analysis.skills, null, 2).slice(0, 100000),
    });

    try {
      let cleaned = result.trim();
      if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
      const parsed = JSON.parse(cleaned);
      analysis.skills = parsed;
      console.log(`  ${rawCount} → ${parsed.skills?.length || 0} skills`);
    } catch (e) {
      console.error('  Failed to parse consolidated skills, keeping originals');
    }
  }

  console.log('  Regenerating output files...');
  await generate(analysis, {
    outputDir,
    hearthline: false,
    letta: false,
    aiName,
    userName,
  });

  console.log('  Done. Files regenerated.');
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
