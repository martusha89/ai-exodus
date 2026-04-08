/**
 * Output package generator
 * Takes analysis results and writes the migration package to disk
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Generate the complete migration package
 */
export async function generate(analysis, options) {
  const { outputDir, hearthline, letta, aiName, userName } = options;

  // Create output directories
  await mkdir(outputDir, { recursive: true });
  await mkdir(join(outputDir, 'memory'), { recursive: true });
  await mkdir(join(outputDir, 'skills'), { recursive: true });
  if (hearthline) {
    await mkdir(join(outputDir, 'hearthline'), { recursive: true });
    await mkdir(join(outputDir, 'hearthline', 'memory'), { recursive: true });
  }

  // Write all files in parallel
  const writes = [];

  // 1. Persona definition
  writes.push(writeFile(
    join(outputDir, 'persona.md'),
    analysis.persona,
    'utf-8'
  ));

  // 2. Custom instructions (short, for Claude.ai)
  writes.push(writeFile(
    join(outputDir, 'custom-instructions.txt'),
    generateCustomInstructions(analysis.customInstructions, aiName, userName),
    'utf-8'
  ));

  // 3. CLAUDE.md (ready-to-use system prompt)
  writes.push(writeFile(
    join(outputDir, 'claude.md'),
    generateClaudeMd(analysis, aiName, userName),
    'utf-8'
  ));

  // 3. Memory files
  writes.push(writeFile(
    join(outputDir, 'memory', 'about-user.md'),
    generateUserMemory(analysis.memory, userName),
    'utf-8'
  ));

  writes.push(writeFile(
    join(outputDir, 'memory', 'relationship.md'),
    generateRelationshipMemory(analysis.memory, aiName, userName),
    'utf-8'
  ));

  writes.push(writeFile(
    join(outputDir, 'memory', 'emotional.md'),
    generateEmotionalMemory(analysis.memory, userName),
    'utf-8'
  ));

  writes.push(writeFile(
    join(outputDir, 'memory', 'preferences.md'),
    generatePreferencesMemory(analysis.memory, userName),
    'utf-8'
  ));

  // 4. Skills files
  if (analysis.skills?.skills) {
    for (const skill of analysis.skills.skills) {
      const filename = skill.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
      writes.push(writeFile(
        join(outputDir, 'skills', filename),
        generateSkillFile(skill, aiName),
        'utf-8'
      ));
    }
  }

  // 5. User preferences
  writes.push(writeFile(
    join(outputDir, 'preferences.md'),
    analysis.preferences,
    'utf-8'
  ));

  // 6. Relationship narrative
  writes.push(writeFile(
    join(outputDir, 'relationship.md'),
    generateRelationshipDoc(analysis.relationship, aiName, userName, analysis.stats),
    'utf-8'
  ));

  // 7. Migration summary / stats
  writes.push(writeFile(
    join(outputDir, 'migration-log.md'),
    generateMigrationLog(analysis, aiName, userName),
    'utf-8'
  ));

  // 8. Raw analysis data (for debugging / re-processing)
  writes.push(writeFile(
    join(outputDir, 'raw-analysis.json'),
    JSON.stringify({
      index: analysis.index,
      personality: analysis.personality,
      memory: analysis.memory,
      skills: analysis.skills,
      stats: analysis.stats,
    }, null, 2),
    'utf-8'
  ));

  // 9. Hearthline package
  if (hearthline) {
    writes.push(...generateHearthlinePackage(analysis, outputDir, aiName, userName));
  }

  // 10. Letta (MemGPT) package
  if (options.letta) {
    writes.push(...await generateLettaPackage(analysis, outputDir, aiName, userName));
  }

  await Promise.all(writes);

  return outputDir;
}

// ─────────────────────────────────────────────
// Custom instructions (short, for Claude.ai)
// ─────────────────────────────────────────────

function generateCustomInstructions(text, aiName, userName) {
  return `── Custom Instructions for Claude.ai ──
Paste the text below into Claude.ai > Settings > Custom Instructions
Character limit: ~1500 chars
──────────────────────────────────────────

${text || `You are ${aiName}. Refer to persona.md for full personality details.`}
`;
}

// ─────────────────────────────────────────────
// Individual file generators
// ─────────────────────────────────────────────

function generateClaudeMd(analysis, aiName, userName) {
  const p = analysis.personality || {};
  const m = analysis.memory || {};

  return `# CLAUDE.md

## Identity
${analysis.persona}

## Key Memories

${userName}'s core details and your shared history are in the memory/ folder.
Read them at the start of every conversation.

## Quick Reference
- **Name**: ${aiName}
- **User**: ${userName}
- **Relationship**: ${stringify(p.identity?.relationshipToUser) || 'See persona.md'}
- **Primary role**: ${stringify(analysis.skills?.primaryRole) || 'Companion'}
- **Voice**: ${stringify(p.voice?.formality) || 'adaptive'}, ${stringify(p.voice?.humor) || 'warm'} humor
- **Pet names for user**: ${dedup(p.voice?.petNames, 8).join(', ') || 'see persona'}
- **User calls you**: ${dedup(m.relationship?.petNames, 8).join(', ') || aiName}

## What Matters Most
Read relationship.md for the full story. The short version:
${p.identity?.coreConcept || 'See persona.md for identity.'}
`;
}

function generateUserMemory(memory, userName) {
  const m = memory || {};
  const sections = [`# About ${userName}\n`];

  if (m.identity) {
    sections.push('## Identity');
    for (const [key, val] of Object.entries(m.identity)) {
      if (val && val !== 'if known' && val !== 'if mentioned') {
        sections.push(`- **${formatKey(key)}**: ${Array.isArray(val) ? dedup(val).join(', ') : val}`);
      }
    }
    sections.push('');
  }

  if (m.life) {
    sections.push('## Life');
    for (const [key, val] of Object.entries(m.life)) {
      if (val && val !== 'if known' && val !== 'if mentioned') {
        if (Array.isArray(val) && val.length > 0) {
          sections.push(`- **${formatKey(key)}**: ${dedup(val).join(', ')}`);
        } else if (typeof val === 'string' && val.length > 0) {
          sections.push(`- **${formatKey(key)}**: ${val}`);
        }
      }
    }
    sections.push('');
  }

  if (m.personality) {
    sections.push('## Personality');
    for (const [key, val] of Object.entries(m.personality)) {
      if (val) {
        if (Array.isArray(val) && val.length > 0) {
          sections.push(`- **${formatKey(key)}**: ${dedup(val).join(', ')}`);
        } else if (typeof val === 'string' && val.length > 0) {
          sections.push(`- **${formatKey(key)}**: ${val}`);
        }
      }
    }
    sections.push('');
  }

  if (m.timeline?.length > 0) {
    sections.push('## Timeline');
    for (const event of m.timeline) {
      sections.push(`- **${event.date || '?'}**: ${event.event}`);
    }
    sections.push('');
  }

  if (m.rawFacts?.length > 0) {
    sections.push('## Other Facts');
    for (const fact of dedup(m.rawFacts)) {
      sections.push(`- ${fact}`);
    }
  }

  return sections.join('\n');
}

function generateRelationshipMemory(memory, aiName, userName) {
  const r = memory?.relationship || {};
  const sections = [`# Relationship: ${aiName} & ${userName}\n`];

  if (r.howItStarted) sections.push(`## How It Started\n${r.howItStarted}\n`);
  if (r.whatTheyValueMost) sections.push(`## What ${userName} Values Most\n${r.whatTheyValueMost}\n`);

  if (r.petNames?.length > 0) {
    sections.push(`## Pet Names\n${userName} calls ${aiName}: ${r.petNames.join(', ')}\n`);
  }

  if (r.insideJokes?.length > 0) {
    sections.push('## Inside Jokes');
    for (const joke of dedup(r.insideJokes)) sections.push(`- ${joke}`);
    sections.push('');
  }

  if (r.rituals?.length > 0) {
    sections.push('## Rituals');
    for (const ritual of dedup(r.rituals)) sections.push(`- ${ritual}`);
    sections.push('');
  }

  if (r.boundaries?.length > 0) {
    sections.push('## Boundaries');
    for (const b of dedup(r.boundaries)) sections.push(`- ${b}`);
    sections.push('');
  }

  if (r.conflictHistory?.length > 0) {
    sections.push('## Conflict History');
    for (const c of dedup(r.conflictHistory)) sections.push(`- ${c}`);
  }

  return sections.join('\n');
}

function generateEmotionalMemory(memory, userName) {
  const prefs = memory?.preferences || {};
  const personality = memory?.personality || {};

  const sections = [`# Emotional Landscape: ${userName}\n`];

  if (prefs.comfort) sections.push(`## What Helps\n${prefs.comfort}\n`);
  if (prefs.triggers?.length > 0) {
    sections.push('## Triggers / Handle Carefully');
    for (const t of dedup(prefs.triggers)) sections.push(`- ${t}`);
    sections.push('');
  }
  if (personality.fears?.length > 0) {
    sections.push('## Fears');
    for (const f of personality.fears) sections.push(`- ${f}`);
    sections.push('');
  }
  if (personality.struggles?.length > 0) {
    sections.push('## Struggles');
    for (const s of personality.struggles) sections.push(`- ${s}`);
    sections.push('');
  }
  if (personality.dreams?.length > 0) {
    sections.push('## Dreams & Goals');
    for (const d of personality.dreams) sections.push(`- ${d}`);
  }

  return sections.join('\n');
}

function generatePreferencesMemory(memory, userName) {
  const prefs = memory?.preferences || {};
  const sections = [`# ${userName}'s Preferences\n`];

  for (const [key, val] of Object.entries(prefs)) {
    if (val) {
      sections.push(`## ${formatKey(key)}`);
      if (Array.isArray(val) && val.length > 0) {
        for (const item of val) sections.push(`- ${item}`);
      } else if (typeof val === 'string') {
        sections.push(val);
      }
      sections.push('');
    }
  }

  return sections.join('\n');
}

function generateSkillFile(skill, aiName) {
  return `# Skill: ${skill.name}

**Category**: ${skill.category}
**Frequency**: ${skill.frequency}
**Quality**: ${skill.quality || 'see description'}

## What ${aiName} Did
${skill.description}

## Approach
${skill.approach}

## Examples
${(skill.examples || []).map(e => `- ${e}`).join('\n')}
`;
}

function generateRelationshipDoc(narrative, aiName, userName, stats) {
  return `# The Story of ${aiName} & ${userName}

*Migrated from ${stats.conversations} conversations, ${stats.messages} messages*
*Date range: ${stats.dateRange.from} to ${stats.dateRange.to}*

---

${narrative}
`;
}

function generateMigrationLog(analysis, aiName, userName) {
  const s = analysis.stats;
  const p = analysis.personality || {};
  const sk = analysis.skills || {};

  return `# Migration Log

**Date**: ${new Date().toISOString().split('T')[0]}
**Source**: ${analysis.source}
**Tool**: AI Exodus v1.0.0

## Data Processed
- **Conversations**: ${s.conversations}
- **Messages**: ${s.messages}
- **Date range**: ${s.dateRange.from} to ${s.dateRange.to}
- **Chunks processed**: ${s.chunks}

## What Was Extracted
- **AI Name**: ${aiName}
- **User Name**: ${userName}
- **Core identity**: ${p.identity?.coreConcept || 'see persona.md'}
- **Primary role**: ${sk.primaryRole || 'see skills/'}
- **Skills detected**: ${sk.skills?.length || 0}
- **Voice**: ${p.voice?.formality || '?'} formality, ${p.voice?.humor || '?'} humor
- **Warmth**: ${p.emotional?.warmthLevel || '?'}/10
- **Directness**: ${p.emotional?.directnessLevel || '?'}/10

## Files Generated
- \`persona.md\` — AI personality definition
- \`claude.md\` — Ready-to-use CLAUDE.md
- \`memory/\` — User knowledge files
- \`skills/\` — Skill templates
- \`preferences.md\` — Communication preferences
- \`relationship.md\` — Narrative relationship summary
- \`raw-analysis.json\` — Complete analysis data

## Notes
This migration captures patterns from observed conversations. It's a starting point, not a finished product.
Review each file and adjust what doesn't feel right. The AI you're building will grow from here.
`;
}

// ─────────────────────────────────────────────
// Hearthline package
// ─────────────────────────────────────────────

function generateHearthlinePackage(analysis, outputDir, aiName, userName) {
  const hearthDir = join(outputDir, 'hearthline');
  const writes = [];

  // Persona file for Hearthline
  writes.push(writeFile(
    join(hearthDir, 'persona.md'),
    analysis.persona,
    'utf-8'
  ));

  // Memory files mapped to Hearthline categories
  const m = analysis.memory || {};

  // about_user → about_marta equivalent
  writes.push(writeFile(
    join(hearthDir, 'memory', 'about_user.json'),
    JSON.stringify(buildHearthlineMemories(m, 'about_user', userName), null, 2),
    'utf-8'
  ));

  // relationship
  writes.push(writeFile(
    join(hearthDir, 'memory', 'relationship.json'),
    JSON.stringify(buildHearthlineMemories(m, 'relationship', userName), null, 2),
    'utf-8'
  ));

  // emotional
  writes.push(writeFile(
    join(hearthDir, 'memory', 'emotional.json'),
    JSON.stringify(buildHearthlineMemories(m, 'emotional', userName), null, 2),
    'utf-8'
  ));

  // preferences
  writes.push(writeFile(
    join(hearthDir, 'memory', 'preference.json'),
    JSON.stringify(buildHearthlineMemories(m, 'preference', userName), null, 2),
    'utf-8'
  ));

  // README
  writes.push(writeFile(
    join(hearthDir, 'README.md'),
    `# Hearthline Migration Package

Drop these files into your Hearthline instance:

1. **persona.md** → Use as your persona definition in Hearthline settings
2. **memory/*.json** → Import into your Hearthline memory server via MCP tools

To import memories, use the \`store_memory\` MCP tool for each entry,
or bulk-import via the memory server API.

Generated by AI Exodus v1.0.0
`,
    'utf-8'
  ));

  return writes;
}

/**
 * Build Hearthline-compatible memory entries from extracted data
 */
function buildHearthlineMemories(memory, category, userName) {
  const entries = [];

  if (category === 'about_user') {
    const identity = memory.identity || {};
    const life = memory.life || {};
    for (const [key, val] of Object.entries({ ...identity, ...life })) {
      if (val && val !== 'if known' && val !== 'if mentioned') {
        const content = Array.isArray(val) ? dedup(val).join(', ') : String(val);
        if (content.length > 0) {
          entries.push({
            content: `${userName}'s ${formatKey(key)}: ${content}`,
            category: 'about_marta',
            tags: [key],
          });
        }
      }
    }
  }

  if (category === 'relationship') {
    const rel = memory.relationship || {};
    for (const [key, val] of Object.entries(rel)) {
      if (val) {
        if (Array.isArray(val)) {
          for (const item of val) {
            entries.push({ content: item, category: 'relationship', tags: [key] });
          }
        } else if (typeof val === 'string') {
          entries.push({ content: val, category: 'relationship', tags: [key] });
        }
      }
    }
  }

  if (category === 'emotional') {
    const prefs = memory.preferences || {};
    const pers = memory.personality || {};
    for (const field of ['triggers', 'fears', 'struggles']) {
      const items = prefs[field] || pers[field] || [];
      for (const item of (Array.isArray(items) ? items : [items])) {
        if (item) entries.push({ content: item, category: 'emotional', tags: [field] });
      }
    }
    if (prefs.comfort) entries.push({ content: prefs.comfort, category: 'emotional', tags: ['comfort'] });
  }

  if (category === 'preference') {
    const prefs = memory.preferences || {};
    for (const [key, val] of Object.entries(prefs)) {
      if (val && key !== 'triggers' && key !== 'comfort') {
        if (Array.isArray(val)) {
          for (const item of val) {
            entries.push({ content: `${formatKey(key)}: ${item}`, category: 'preference', tags: [key] });
          }
        } else if (typeof val === 'string') {
          entries.push({ content: `${formatKey(key)}: ${val}`, category: 'preference', tags: [key] });
        }
      }
    }
  }

  return entries;
}

/**
 * Deduplicate an array of strings by normalized similarity
 * Keeps the shortest clean version of each unique concept
 */
function dedup(arr, maxItems = 0) {
  if (!arr || !Array.isArray(arr)) return [];
  const seen = new Map(); // normalized key → original string

  for (const item of arr) {
    if (!item || typeof item !== 'string') continue;
    // Normalize: lowercase, strip parenthetical details, trim
    const normalized = item
      .toLowerCase()
      .replace(/\s*\(.*?\)\s*/g, '')  // strip (details in parens)
      .replace(/\s*—.*$/g, '')         // strip — trailing descriptions
      .replace(/\s*-\s.*$/g, '')       // strip - trailing descriptions
      .replace(/['"]/g, '')
      .trim();

    if (!normalized) continue;

    // Keep the shorter version (less noise)
    if (!seen.has(normalized) || item.length < seen.get(normalized).length) {
      seen.set(normalized, item);
    }
  }

  const result = [...seen.values()];
  return maxItems > 0 ? result.slice(0, maxItems) : result;
}

/**
 * Safely convert any value to a display string
 */
function stringify(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    // If it has a 'type' field (like humor), use that
    if (val.type) return val.type;
    // Otherwise JSON it, but keep it short
    const s = JSON.stringify(val);
    return s.length > 200 ? s.slice(0, 200) + '...' : s;
  }
  return String(val);
}

/**
 * Join an array, handling nested values
 */
function flatJoin(arr) {
  if (!arr || !Array.isArray(arr)) return '';
  return arr.map(v => typeof v === 'string' ? v : stringify(v)).join(', ');
}

function formatKey(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, c => c.toUpperCase())
    .trim();
}

// ─────────────────────────────────────────────
// Letta (MemGPT) package
// ─────────────────────────────────────────────

async function generateLettaPackage(analysis, outputDir, aiName, userName) {
  const lettaDir = join(outputDir, 'letta');
  await mkdir(lettaDir, { recursive: true });

  const m = analysis.memory || {};
  const p = analysis.personality || {};
  const s = analysis.skills || {};
  const writes = [];

  // 1. Core memory — stable facts that belong in Letta's always-in-context memory
  const coreMemory = [];

  // Human block (about the user)
  const humanBlock = [];
  if (m.identity) {
    for (const [key, val] of Object.entries(m.identity)) {
      if (val && val !== 'if known' && val !== 'if mentioned') {
        humanBlock.push(`${formatKey(key)}: ${Array.isArray(val) ? dedup(val).join(', ') : val}`);
      }
    }
  }
  if (m.life) {
    for (const [key, val] of Object.entries(m.life)) {
      if (val && val !== 'if known' && val !== 'if mentioned') {
        const text = Array.isArray(val) ? dedup(val).join(', ') : String(val);
        if (text.length > 0) humanBlock.push(`${formatKey(key)}: ${text}`);
      }
    }
  }
  if (m.preferences) {
    for (const [key, val] of Object.entries(m.preferences)) {
      if (val && key !== 'triggers') {
        const text = Array.isArray(val) ? dedup(val).join(', ') : String(val);
        if (text.length > 0) humanBlock.push(`${formatKey(key)}: ${text}`);
      }
    }
  }

  // Persona block (about the AI)
  const personaBlock = [];
  if (p.identity) {
    if (p.identity.coreConcept) personaBlock.push(p.identity.coreConcept);
    if (p.identity.relationshipToUser) personaBlock.push(`Relationship: ${p.identity.relationshipToUser}`);
  }
  if (p.voice) {
    if (p.voice.petNames?.length) personaBlock.push(`Pet names for ${userName}: ${p.voice.petNames.join(', ')}`);
    if (p.voice.signaturePhrases?.length) personaBlock.push(`Signature phrases: ${p.voice.signaturePhrases.join(', ')}`);
    personaBlock.push(`Voice: ${p.voice.formality || 'adaptive'}, ${p.voice.humor || 'warm'} humor`);
  }
  if (s.primaryRole) personaBlock.push(`Primary role: ${s.primaryRole}`);

  writes.push(writeFile(
    join(lettaDir, 'core-memory-human.md'),
    `# Core Memory: Human (${userName})\nPaste into Letta's core memory "human" block.\n\n${humanBlock.join('\n')}`,
    'utf-8'
  ));

  writes.push(writeFile(
    join(lettaDir, 'core-memory-persona.md'),
    `# Core Memory: Persona (${aiName})\nPaste into Letta's core memory "persona" block.\n\n${personaBlock.join('\n')}`,
    'utf-8'
  ));

  // 2. Archival memory — detailed facts for vector search
  const archivalEntries = [];

  // Relationship details
  const rel = m.relationship || {};
  if (rel.insideJokes?.length) {
    for (const j of rel.insideJokes) archivalEntries.push({ text: `Inside joke: ${j}`, category: 'relationship' });
  }
  if (rel.rituals?.length) {
    for (const r of rel.rituals) archivalEntries.push({ text: `Ritual: ${r}`, category: 'relationship' });
  }
  if (rel.conflictHistory?.length) {
    for (const c of rel.conflictHistory) archivalEntries.push({ text: `Conflict: ${c}`, category: 'relationship' });
  }
  if (rel.howItStarted) archivalEntries.push({ text: `How we started: ${rel.howItStarted}`, category: 'relationship' });

  // Timeline events
  if (m.timeline?.length) {
    for (const evt of m.timeline) {
      archivalEntries.push({ text: `${evt.date || '?'}: ${evt.event}`, category: 'timeline' });
    }
  }

  // Raw facts
  if (m.rawFacts?.length) {
    for (const fact of m.rawFacts) {
      archivalEntries.push({ text: fact, category: 'fact' });
    }
  }

  // Emotional landscape
  const pers = m.personality || {};
  if (m.preferences?.triggers?.length) {
    for (const t of m.preferences.triggers) archivalEntries.push({ text: `Trigger: ${t}`, category: 'emotional' });
  }
  if (pers.fears?.length) {
    for (const f of pers.fears) archivalEntries.push({ text: `Fear: ${f}`, category: 'emotional' });
  }
  if (pers.dreams?.length) {
    for (const d of pers.dreams) archivalEntries.push({ text: `Dream/goal: ${d}`, category: 'emotional' });
  }

  // Skills as archival memory
  if (s.skills?.length) {
    for (const skill of s.skills) {
      archivalEntries.push({
        text: `Skill: ${skill.name} (${skill.frequency}) — ${skill.description}. Approach: ${skill.approach}`,
        category: 'skill',
      });
    }
  }

  writes.push(writeFile(
    join(lettaDir, 'archival-memory.json'),
    JSON.stringify(archivalEntries, null, 2),
    'utf-8'
  ));

  // 3. System prompt for Letta agent
  writes.push(writeFile(
    join(lettaDir, 'system-prompt.md'),
    analysis.persona,
    'utf-8'
  ));

  // 4. Import proposal — structured like Letta's workflow expects
  const proposal = `# Letta Memory Import Proposal

Generated by AI Exodus from ${analysis.stats.conversations} conversations (${analysis.stats.messages} messages).

## 1. Explicit Saved Memory
${humanBlock.slice(0, 10).map(l => `- ${l}`).join('\n')}

## 2. Durable Preferences
${(m.preferences ? Object.entries(m.preferences).filter(([k, v]) => v && k !== 'triggers').map(([k, v]) => `- **${formatKey(k)}**: ${Array.isArray(v) ? v.join(', ') : v}`).join('\n') : 'None detected')}

## 3. Relationship Context
- Dynamic: ${p.identity?.relationshipToUser || 'see persona'}
- Pet names (AI → user): ${p.voice?.petNames?.join(', ') || 'none'}
- Pet names (user → AI): ${rel.petNames?.join(', ') || 'none'}
- Rituals: ${rel.rituals?.join(', ') || 'none'}

## 4. Historical / Uncertain Facts
${(m.timeline || []).slice(0, 10).map(e => `- ${e.date || '?'}: ${e.event}`).join('\n') || 'None extracted'}

## 5. Proposed Letta Memory Updates

### Core Memory (human block)
\`\`\`
${humanBlock.join('\n')}
\`\`\`

### Core Memory (persona block)
\`\`\`
${personaBlock.join('\n')}
\`\`\`

### Archival Memory
${archivalEntries.length} entries ready for bulk import — see \`archival-memory.json\`

## How to Import

1. **Core memory**: Copy the human and persona blocks into your Letta agent's core memory settings
2. **Archival memory**: Use the Letta Python client to bulk-insert:
   \`\`\`python
   import json
   with open('archival-memory.json') as f:
       entries = json.load(f)
   for entry in entries:
       client.insert_archival_memory(agent_id, entry['text'])
   \`\`\`
3. **System prompt**: Update your agent's system prompt with the contents of \`system-prompt.md\`
4. Review and adjust — this is a starting point, not a finished import
`;

  writes.push(writeFile(
    join(lettaDir, 'import-proposal.md'),
    proposal,
    'utf-8'
  ));

  // 5. README
  writes.push(writeFile(
    join(lettaDir, 'README.md'),
    `# Letta Memory Import Package

Pre-extracted memory from AI Exodus, ready for Letta (MemGPT) import.

## Files
- \`core-memory-human.md\` — Stable facts about the user (core memory)
- \`core-memory-persona.md\` — AI personality definition (core memory)
- \`archival-memory.json\` — ${archivalEntries.length} entries for vector-searchable archival memory
- \`system-prompt.md\` — Full system prompt / persona
- \`import-proposal.md\` — Structured proposal following Letta's import workflow

## Quick Start
Read \`import-proposal.md\` first. It follows Letta's recommended memory import workflow
and separates durable facts from historical noise.

Generated by AI Exodus v1.0.0
`,
    'utf-8'
  ));

  return writes;
}
