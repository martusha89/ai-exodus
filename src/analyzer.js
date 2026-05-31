/**
 * 5-pass conversation analyzer
 * Processes chunked conversations through Claude for extraction
 * Checkpoints after every chunk — resume on crash
 */

import { callAI } from './ai.js';
import { chunkConversations, formatChunk } from './parser.js';
import { Spinner } from './spinner.js';
import { Checkpoint } from './checkpoint.js';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  PASS_1_INDEX,
  PASS_2_PERSONALITY,
  PASS_3_MEMORY,
  PASS_4_SKILLS,
  PASS_5_RELATIONSHIP,
  SYNTHESIS_PERSONA,
  SYNTHESIS_PREFERENCES,
  SYNTHESIS_CUSTOM_INSTRUCTIONS,
} from '../prompts/index.js';

const PASS_NAMES = [
  'Indexing & mapping conversations',
  'Extracting personality',
  'Extracting memories',
  'Detecting skills',
  'Mapping relationship',
];

/**
 * Run the 5-pass analysis pipeline
 */
export async function analyze(parsed, options) {
  const { model, aiName, userName, includeNsfw, verbose, outputDir, fast, selectedPasses, retrySkipped, clearCheckpoint = true } = options;
  const runPass1 = !selectedPasses || selectedPasses.includes(1);
  const runPass2 = !selectedPasses || selectedPasses.includes(2);
  const runPass3 = !selectedPasses || selectedPasses.includes(3);
  const runPass4 = !selectedPasses || selectedPasses.includes(4);
  const runPass5 = !selectedPasses || selectedPasses.includes(5);
  const chunks = chunkConversations(parsed.conversations);

  if (verbose) console.log(`    Split into ${chunks.length} chunk(s) for processing`);

  // Set up checkpoint
  const checkDir = resolve(outputDir || './exodus-output');
  await mkdir(checkDir, { recursive: true });
  const checkpoint = new Checkpoint(checkDir);
  const existing = await checkpoint.load();

  if (existing) {
    const completedPasses = Object.keys(existing.passes || {}).filter(k => existing.passes[k].complete);
    console.log(`    Resuming from checkpoint (${completedPasses.length} passes complete, saved ${existing.savedAt})`);

    // If user passed --retry-skipped, clear ALL skip records (any reason).
    // Otherwise, auto-clear only context-too-big skips — those are retryable
    // once the user has enabled 1M context extra usage at claude.ai/settings/usage.
    // AUP skips stay (content filter, no point retrying).
    const reasonsToClear = retrySkipped ? null : ['context-too-big'];
    const cleared = await checkpoint.clearSkippedChunks(reasonsToClear);
    if (cleared > 0) {
      const label = retrySkipped ? 'all skipped chunks' : 'context-too-big skips';
      console.log(`    Clearing ${cleared} ${label} for retry`);
    }
  }

  const spinner = new Spinner();

  /**
   * Pick a representative sample of chunk indices
   * Grabs from start, middle, end + longest chunks
   */
  function sampleChunkIndices(maxSamples = 15) {
    if (chunks.length <= maxSamples) return chunks.map((_, i) => i);

    const indices = new Set();

    // First 3 (early conversations)
    for (let i = 0; i < 3 && i < chunks.length; i++) indices.add(i);
    // Last 3 (recent conversations)
    for (let i = chunks.length - 3; i < chunks.length; i++) indices.add(i);
    // Middle 3
    const mid = Math.floor(chunks.length / 2);
    for (let i = mid - 1; i <= mid + 1; i++) if (i >= 0 && i < chunks.length) indices.add(i);

    // Fill the rest evenly spaced
    const step = Math.floor(chunks.length / (maxSamples - indices.size));
    for (let i = 0; i < chunks.length && indices.size < maxSamples; i += Math.max(step, 1)) {
      indices.add(i);
    }

    return [...indices].sort((a, b) => a - b);
  }

  // Helper: run a pass across chunks with spinner + checkpoint
  // sampleOnly: only process representative sample
  // useHaiku: use haiku model for this pass (cheaper, faster)
  async function runPass(passNum, passName, systemPromptFn, { sampleOnly = false, useHaiku = false } = {}) {
    const passModel = useHaiku ? 'haiku' : model;
    const targetIndices = sampleOnly ? sampleChunkIndices(15) : chunks.map((_, i) => i);
    const totalToProcess = targetIndices.length;

    // Skip if fully complete
    if (checkpoint.isPassComplete(passNum)) {
      const results = checkpoint.getPassResults(passNum);
      console.log(`    [${passNum}/5] ${passName}... (cached, ${results.length} chunks)`);
      return results;
    }

    const parts = [passName];
    if (sampleOnly) parts.push(`sampling ${totalToProcess}/${chunks.length} chunks`);
    if (useHaiku) parts.push('haiku');
    const label = parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(', ')})` : parts[0];
    console.log(`    [${passNum}/5] ${label}...`);
    const completedChunks = checkpoint.getCompletedChunks(passNum);
    const existingResults = checkpoint.getPassResults(passNum) || [];
    const results = [...existingResults];

    const remaining = targetIndices.filter(i => !completedChunks.includes(i));
    if (completedChunks.length > 0 && remaining.length > 0) {
      const priorSkipped = checkpoint.getSkippedChunks(passNum);
      const resumeNote = priorSkipped.length > 0
        ? `${remaining.length} chunks remaining (${priorSkipped.length} previously skipped)`
        : `${remaining.length} chunks remaining`;
      console.log(`          Resuming — ${resumeNote}`);
    }

    const MAX_CHUNK_KB = 400; // Split chunks larger than this preemptively
    const MIN_SPLIT_MESSAGES = 4; // Below this, can't meaningfully split a convo further
    const MAX_SPLIT_DEPTH = 5; // 1→2→4→8→16→32 sub-pieces max
    const passSkipped = []; // skips recorded during this run

    // Pass-specific merge function for sub-results
    const mergeForPass = (resultsArr) => {
      if (passNum === 3) return mergeMemory(resultsArr);
      if (passNum === 4) return mergeSkills(resultsArr);
      if (passNum === 2) return mergePersonality(resultsArr);
      return mergeMemory(resultsArr); // fallback
    };

    // Split a convo array in half. If only 1 convo, split its messages.
    // Returns [convoArrayA, convoArrayB] or null if can't split further.
    const splitConvos = (convos) => {
      if (convos.length > 1) {
        const mid = Math.ceil(convos.length / 2);
        return [convos.slice(0, mid), convos.slice(mid)];
      }
      const convo = convos[0];
      if (!convo?.messages || convo.messages.length < MIN_SPLIT_MESSAGES) return null;
      const mid = Math.ceil(convo.messages.length / 2);
      const titleA = `${convo.title} (part 1)`;
      const titleB = `${convo.title} (part 2)`;
      return [
        [{ ...convo, title: titleA, messages: convo.messages.slice(0, mid) }],
        [{ ...convo, title: titleB, messages: convo.messages.slice(mid) }],
      ];
    };

    // Recursively process a chunk: try as one call, split on context-too-big, merge results.
    // Throws on AUP, unknown errors, or when split depth exhausted.
    const processChunk = async (convos, depth, label) => {
      const text = formatChunk(convos);
      const kb = text.length / 1024;

      // Preemptive split for oversized chunks at top level
      if (depth === 0 && kb > MAX_CHUNK_KB) {
        const halves = splitConvos(convos);
        if (halves) {
          spinner.update(`${label} (${kb.toFixed(0)}KB → preemptive split)`);
          const a = await processChunk(halves[0], depth + 1, label);
          const b = await processChunk(halves[1], depth + 1, label);
          return mergeForPass([a, b]);
        }
      }

      try {
        const result = await callAI({
          model: passModel,
          system: systemPromptFn(),
          prompt: text,
        });
        return safeParseJSON(result, `Pass ${passNum} d${depth}`);
      } catch (err) {
        // Only context-too-big is split-retryable. Other skip reasons + unknown errors bubble up.
        if (err.skipReason !== 'context-too-big') throw err;
        if (depth >= MAX_SPLIT_DEPTH) throw err;
        const halves = splitConvos(convos);
        if (!halves) throw err; // can't split further — give up
        spinner.update(`${label} (${kb.toFixed(0)}KB too big, splitting at depth ${depth + 1})`);
        const [a, b] = await Promise.all([
          processChunk(halves[0], depth + 1, label),
          processChunk(halves[1], depth + 1, label),
        ]);
        return mergeForPass([a, b]);
      }
    };

    let processed = totalToProcess - remaining.length;
    for (const i of remaining) {
      processed++;
      const chunkText = formatChunk(chunks[i]);
      const chunkKB = chunkText.length / 1024;
      const label = `Chunk ${processed}/${totalToProcess}`;

      try {
        spinner.start(`${label} (${chunkKB.toFixed(0)}KB)`);
        const parsed = await processChunk(chunks[i], 0, label);

        results[i] = parsed;
        spinner.stop(`${label} done`);

        // Checkpoint after every chunk
        await checkpoint.saveChunkResult(passNum, i, parsed, totalToProcess);
      } catch (err) {
        const reason = err.skipReason;
        if (reason) {
          spinner.warn(`${label} skipped (${reason})`);
          console.warn(`          Reason: ${err.message.slice(0, 200)}`);
          passSkipped.push({ index: i, reason, message: err.message });
          await checkpoint.saveChunkSkipped(passNum, i, reason, err.message, totalToProcess);
          continue;
        }

        spinner.fail(`${label} failed: ${err.message}`);
        console.error(`          Progress saved. Re-run the same command to resume.`);
        throw err;
      }
    }

    if (passSkipped.length > 0) {
      const byReason = passSkipped.reduce((acc, s) => { acc[s.reason] = (acc[s.reason] || 0) + 1; return acc; }, {});
      const summary = Object.entries(byReason).map(([r, n]) => `${n} ${r}`).join(', ');
      console.log(`          Skipped ${passSkipped.length} chunk(s): ${summary}`);
    }

    // Filter out empty slots from sampling
    return results.filter(r => r != null);
  }

  // Helper: get or compute merged data
  async function getOrMerge(key, results, mergeFn) {
    const cached = checkpoint.getMergedData(key);
    if (cached) {
      if (verbose) console.log(`          Using cached ${key}`);
      return cached;
    }
    const merged = await mergeFn(results);
    await checkpoint.saveMerged(key, merged);
    return merged;
  }

  // ═══════════════════════════════════════════
  // PASS 1: Structure & Index (always runs — dependency for others)
  // ═══════════════════════════════════════════
  let indexData = {};
  if (runPass1) {
    const indexResults = await runPass(1, PASS_NAMES[0], () => PASS_1_INDEX(aiName, userName),
      { useHaiku: fast });

    indexData = await getOrMerge('index', indexResults, async (r) => {
      return mergeIndexResults(r, aiName, userName);
    });
    console.log(`          AI: ${indexData.aiName} | User: ${indexData.userName}`);
    console.log(`          Top topics: ${indexData.topTopics?.slice(0, 5).join(', ')}`);
  } else {
    indexData = checkpoint.getMergedData('index') || {};
  }

  // ═══════════════════════════════════════════
  // PASS 2: Personality Extraction
  // ═══════════════════════════════════════════
  let personalityData = {};
  if (runPass2) {
    const personalityResults = await runPass(2, PASS_NAMES[1],
      () => PASS_2_PERSONALITY(indexData.aiName, indexData.userName, indexData),
      { sampleOnly: true });

    personalityData = await getOrMerge('personality', personalityResults, async (r) => {
      spinner.start('Merging personality data...');
      const result = r.length === 1 ? r[0] : await synthesizeResults(model, 'personality', r, indexData);
      spinner.stop('Personality merged');
      return result;
    });
    console.log(`          Voice: ${personalityData?.voice?.formality || 'detected'}, humor: ${personalityData?.voice?.humor || 'detected'}`);
  } else {
    personalityData = checkpoint.getMergedData('personality') || {};
    const note = Object.keys(personalityData).length ? '(skipped — using cached)' : '(skipped)';
    console.log(`    [2/5] Personality extraction... ${note}`);
  }

  // ═══════════════════════════════════════════
  // PASS 3: Memory Extraction
  // ═══════════════════════════════════════════
  let memoryData = {};
  let factCount = 0;
  if (runPass3) {
    const memoryResults = await runPass(3, PASS_NAMES[2],
      () => PASS_3_MEMORY(indexData.aiName, indexData.userName, indexData));

    memoryData = await getOrMerge('memory', memoryResults, async (r) => {
      spinner.start('Merging memories...');
      const result = r.length === 1 ? r[0] : await synthesizeResults(model, 'memory', r, indexData);
      spinner.stop('Memories merged');
      return result;
    });
    factCount = countFacts(memoryData);
    console.log(`          Extracted ~${factCount} facts about ${indexData.userName}`);
  } else {
    memoryData = checkpoint.getMergedData('memory') || {};
    factCount = countFacts(memoryData);
    const note = factCount > 0 ? `(skipped — using ${factCount} cached facts)` : '(skipped)';
    console.log(`    [3/5] Memory extraction... ${note}`);
  }

  // ═══════════════════════════════════════════
  // PASS 4: Skills Detection
  // ═══════════════════════════════════════════
  let skillsData = {};
  let rawSkillsData = {};
  if (runPass4) {
  // Pass 4: SAMPLED — skills repeat, 15 chunks is enough (haiku in fast mode)
  const skillsResults = await runPass(4, PASS_NAMES[3],
    () => PASS_4_SKILLS(indexData.aiName, indexData.userName, indexData),
    { sampleOnly: true, useHaiku: fast });

  // First: local JS merge to collect all raw skills
  rawSkillsData = skillsResults.length === 1
    ? skillsResults[0]
    : await synthesizeResults(model, 'skills', skillsResults, indexData);

  // Then: one Claude call to consolidate 370 duplicates into ~25 clean skills
  skillsData = await getOrMerge('skills', null, async () => {
    const rawCount = rawSkillsData?.skills?.length || 0;
    if (rawCount <= 30) return rawSkillsData; // already clean enough

    spinner.start(`Consolidating ${rawCount} raw skills into clean list...`);
    const consolidated = await callAI({
      model,
      system: `You are consolidating a list of ${rawCount} extracted skills into a clean, deduplicated list of 15-30 unique skills.

AI: ${indexData.aiName}
User: ${indexData.userName}

Many skills are duplicates with slightly different names (e.g. "AI image prompt engineering" and "Image generation prompt crafting" are the same skill). Merge them.

Rules:
- Combine duplicates into ONE skill with the best name, description, and examples
- Keep 15-30 unique skills maximum
- Preserve the category, frequency (pick the highest), and approach fields
- MERGE trigger data: combine all phrase/temporal/emotional/contextual triggers from duplicate skills, deduplicate
- Each merged skill MUST keep its "triggers" object and "activationRule" field
- The "activationRule" should be refined to one clear IF-THEN sentence after merging
- Pick the most specific and useful description for each
- primaryRole should be ONE clear sentence
- secondaryRoles should be 3-5 items max
- Output ONLY valid JSON with this schema: { "skills": [...], "primaryRole": "...", "secondaryRoles": [...] }
- No markdown fences. No commentary.`,
      prompt: JSON.stringify(rawSkillsData, null, 2).slice(0, 100000), // cap input
    });
    spinner.stop('Skills consolidated');
    return safeParseJSON(consolidated, 'skills consolidation');
  });
  const skillCount = skillsData?.skills?.length || 0;
  console.log(`          ${rawSkillsData?.skills?.length || 0} raw → ${skillCount} consolidated skills`);
  } else {
    skillsData = checkpoint.getMergedData('skills') || {};
    const note = skillsData?.skills?.length ? `(skipped — using ${skillsData.skills.length} cached)` : '(skipped)';
    console.log(`    [4/5] Skills detection... ${note}`);
  }

  // ═══════════════════════════════════════════
  // PASS 5: Relationship Narrative
  // ═══════════════════════════════════════════
  let relationshipNarrative = '';
  if (runPass5) {
  relationshipNarrative = await getOrMerge('relationship', null, async () => {
    console.log(`    [5/5] ${PASS_NAMES[4]}...`);
    const representativeSample = selectRepresentativeSample(parsed.conversations, chunks);
    let sampleText = formatChunk(representativeSample);

    // Cap the sample at 300KB to avoid "prompt too long"
    if (sampleText.length > 300000) {
      sampleText = sampleText.slice(0, 300000) + '\n\n[... truncated for length — full history was analyzed in prior passes]';
    }

    // Strip bulky data from prior passes to keep system prompt manageable
    const lightIndex = { aiName: indexData.aiName, userName: indexData.userName, topTopics: indexData.topTopics?.slice(0, 10), recurringPatterns: indexData.recurringPatterns?.slice(0, 10), significantMoments: indexData.significantMoments?.slice(0, 15) };
    const lightPersonality = { identity: personalityData?.identity, voice: { formality: personalityData?.voice?.formality, humor: personalityData?.voice?.humor?.type || personalityData?.voice?.humor, petNames: personalityData?.voice?.petNames, signaturePhrases: personalityData?.voice?.signaturePhrases?.slice(0, 5) }, emotional: personalityData?.emotional, quirks: personalityData?.quirks?.slice(0, 10) };
    const lightMemory = { userName: memoryData?.userName, identity: memoryData?.identity, relationship: { petNames: memoryData?.relationship?.petNames?.slice(0, 10), insideJokes: memoryData?.relationship?.insideJokes?.slice(0, 15), rituals: memoryData?.relationship?.rituals?.slice(0, 10), howItStarted: memoryData?.relationship?.howItStarted } };

    spinner.start('Writing your story...');
    const result = await callAI({
      model,
      system: PASS_5_RELATIONSHIP(
        indexData.aiName, indexData.userName,
        lightIndex, lightPersonality, lightMemory
      ),
      prompt: sampleText,
    });
    spinner.stop('Relationship narrative complete');
    return result;
  });
  } else {
    relationshipNarrative = checkpoint.getMergedData('relationship') || '';
    const note = relationshipNarrative ? '(skipped — using cached)' : '(skipped)';
    console.log(`    [5/5] Relationship narrative... ${note}`);
  }

  // ═══════════════════════════════════════════
  // SYNTHESIS: Generate final outputs (only if relevant passes ran)
  // ═══════════════════════════════════════════
  let persona = '';
  let preferences = '';
  let customInstructions = '';

  if (runPass2 || runPass4) {
  persona = await getOrMerge('persona', null, async () => {
    spinner.start('Generating persona definition...');
    const result = await callAI({
      model,
      system: SYNTHESIS_PERSONA(indexData.aiName, personalityData, skillsData),
      prompt: 'Generate the system prompt / persona definition based on the analysis provided.',
    });
    spinner.stop('Persona generated');
    return result;
  });
  } else {
    persona = checkpoint.getMergedData('persona') || '';
  }

  if (runPass3) {
  preferences = await getOrMerge('preferences', null, async () => {
    spinner.start('Generating preferences...');
    const result = await callAI({
      model,
      system: SYNTHESIS_PREFERENCES(indexData.userName, memoryData),
      prompt: 'Generate the user preferences document based on the memory analysis provided.',
    });
    spinner.stop('Preferences generated');
    return result;
  });
  } else {
    preferences = checkpoint.getMergedData('preferences') || '';
  }

  if (runPass2 && runPass3 && runPass4) {
  customInstructions = await getOrMerge('customInstructions', null, async () => {
    spinner.start('Generating custom instructions (short, for Claude.ai)...');
    const result = await callAI({
      model,
      system: SYNTHESIS_CUSTOM_INSTRUCTIONS(indexData.aiName, personalityData, memoryData, skillsData),
      prompt: 'Generate the custom instructions block based on the analysis provided. Max 1500 characters.',
    });
    spinner.stop('Custom instructions generated');
    return result;
  });
  } else {
    customInstructions = checkpoint.getMergedData('customInstructions') || '';
  }

  // Clear checkpoint only when the caller hasn't asked to manage it itself.
  // The portal/local push happens AFTER this function returns, so deferring the
  // clear to the caller means a failed push leaves a recoverable on-disk
  // checkpoint instead of silently wiping completed work.
  if (clearCheckpoint !== false) await checkpoint.clear();

  return {
    index: indexData,
    personality: personalityData,
    memory: memoryData,
    skills: skillsData,
    relationship: relationshipNarrative || '',
    persona: persona || '',
    preferences,
    customInstructions,
    source: parsed.source,
    stats: {
      conversations: parsed.conversations.length,
      messages: parsed.messageCount,
      dateRange: parsed.dateRange,
      chunks: chunks.length,
    },
  };
}

/**
 * When multiple chunks produce separate results, merge them
 */
/**
 * Merge results locally in JS — no Claude calls needed
 */
function synthesizeResults(model, type, results, indexData) {
  const clean = results.filter(r => r && !r._parseError);
  if (clean.length === 0) return results[0] || {};
  if (clean.length === 1) return clean[0];

  switch (type) {
    case 'personality': return mergePersonality(clean);
    case 'memory': return mergeMemory(clean);
    case 'skills': return mergeSkills(clean);
    default: return clean[0]; // fallback: pick first
  }
}

/**
 * Personality: pick the most complete result (most non-empty fields)
 * Then patch in any unique findings from others
 */
function mergePersonality(results) {
  // Score each result by how many non-empty fields it has
  function score(obj) {
    let count = 0;
    function walk(o) {
      if (typeof o === 'string' && o.length > 0) count++;
      else if (Array.isArray(o)) { if (o.length > 0) count += o.length; }
      else if (typeof o === 'object' && o !== null) Object.values(o).forEach(walk);
    }
    walk(obj);
    return count;
  }

  // Pick the richest result as the base
  const sorted = [...results].sort((a, b) => score(b) - score(a));
  const base = JSON.parse(JSON.stringify(sorted[0]));

  // Patch in arrays from other results (pet names, quirks, signature phrases, etc.)
  for (const other of sorted.slice(1)) {
    patchArrays(base, other);
  }

  return base;
}

/**
 * Memory: merge all fields, concatenate arrays, deduplicate strings
 */
function mergeMemory(results) {
  const merged = {};

  for (const result of results) {
    for (const [key, val] of Object.entries(result)) {
      if (!merged[key]) {
        merged[key] = JSON.parse(JSON.stringify(val));
      } else if (Array.isArray(val) && Array.isArray(merged[key])) {
        // Concatenate arrays, deduplicate
        const existing = new Set(merged[key].map(v => typeof v === 'string' ? v : JSON.stringify(v)));
        for (const item of val) {
          const k = typeof item === 'string' ? item : JSON.stringify(item);
          if (!existing.has(k)) {
            merged[key].push(item);
            existing.add(k);
          }
        }
      } else if (typeof val === 'object' && val !== null && typeof merged[key] === 'object') {
        // Recursively merge objects
        mergeObjectDeep(merged[key], val);
      } else if (typeof val === 'string' && (!merged[key] || merged[key].length < val.length)) {
        // Keep the longer/more detailed string
        merged[key] = val;
      }
    }
  }

  return merged;
}

/**
 * Skills: concatenate skill arrays, deduplicate by name
 */
function mergeSkills(results) {
  const allSkills = [];
  const seenNames = new Set();
  let primaryRole = null;
  const secondaryRoles = new Set();

  for (const result of results) {
    if (result.primaryRole && !primaryRole) primaryRole = result.primaryRole;
    if (result.secondaryRoles) result.secondaryRoles.forEach(r => secondaryRoles.add(r));

    for (const skill of (result.skills || [])) {
      const name = (skill.name || '').toLowerCase();
      if (!seenNames.has(name)) {
        seenNames.add(name);
        allSkills.push(skill);
      }
    }
  }

  return {
    skills: allSkills,
    primaryRole: primaryRole || 'companion',
    secondaryRoles: [...secondaryRoles],
  };
}

/**
 * Deep merge: patch source into target, concat arrays, keep longer strings
 */
function mergeObjectDeep(target, source) {
  for (const [key, val] of Object.entries(source)) {
    if (!target[key]) {
      target[key] = JSON.parse(JSON.stringify(val));
    } else if (Array.isArray(val) && Array.isArray(target[key])) {
      const existing = new Set(target[key].map(v => typeof v === 'string' ? v : JSON.stringify(v)));
      for (const item of val) {
        const k = typeof item === 'string' ? item : JSON.stringify(item);
        if (!existing.has(k)) {
          target[key].push(item);
          existing.add(k);
        }
      }
    } else if (typeof val === 'object' && val !== null && typeof target[key] === 'object' && !Array.isArray(val)) {
      mergeObjectDeep(target[key], val);
    } else if (typeof val === 'string' && typeof target[key] === 'string' && val.length > target[key].length) {
      target[key] = val;
    }
  }
}

/**
 * Patch unique array items from source into target
 */
function patchArrays(target, source) {
  if (typeof target !== 'object' || typeof source !== 'object') return;
  if (Array.isArray(target) || Array.isArray(source)) return;

  for (const [key, val] of Object.entries(source)) {
    if (Array.isArray(val) && Array.isArray(target[key])) {
      const existing = new Set(target[key].map(v => typeof v === 'string' ? v : JSON.stringify(v)));
      for (const item of val) {
        const k = typeof item === 'string' ? item : JSON.stringify(item);
        if (!existing.has(k)) {
          target[key].push(item);
          existing.add(k);
        }
      }
    } else if (typeof val === 'object' && val !== null && typeof target[key] === 'object') {
      patchArrays(target[key], val);
    }
  }
}


/**
 * Merge Pass 1 index results across chunks
 */
function mergeIndexResults(results, providedAiName, providedUserName) {
  if (results.length === 1) return results[0];

  const merged = {
    aiName: providedAiName || results.find(r => r.aiName)?.aiName || 'AI',
    userName: providedUserName || results.find(r => r.userName)?.userName || 'User',
    topTopics: [...new Set(results.flatMap(r => r.topTopics || []))],
    conversationTypes: {},
    recurringPatterns: [...new Set(results.flatMap(r => r.recurringPatterns || []))],
    significantMoments: results.flatMap(r => r.significantMoments || []),
    customGPTPrompts: results.flatMap(r => r.customGPTPrompts || []),
    languageInfo: results.find(r => r.languageInfo)?.languageInfo || {},
  };

  for (const result of results) {
    for (const [type, count] of Object.entries(result.conversationTypes || {})) {
      merged.conversationTypes[type] = (merged.conversationTypes[type] || 0) + count;
    }
  }

  return merged;
}

/**
 * Select a representative sample of conversations for the relationship narrative
 */
function selectRepresentativeSample(conversations, chunks) {
  if (conversations.length <= 30) return conversations;

  const sample = [];
  const seen = new Set();

  function add(convo) {
    if (!convo || seen.has(convo.id || convo.title)) return;
    seen.add(convo.id || convo.title);
    sample.push(convo);
  }

  conversations.slice(0, 5).forEach(add);
  conversations.slice(-5).forEach(add);

  const byLength = [...conversations].sort((a, b) => b.messageCount - a.messageCount);
  byLength.slice(0, 5).forEach(add);

  const mid = Math.floor(conversations.length / 2);
  conversations.slice(mid - 2, mid + 3).forEach(add);

  const step = Math.floor(conversations.length / 10);
  for (let i = 0; i < conversations.length && sample.length < 30; i += step) {
    add(conversations[i]);
  }

  return sample;
}

/**
 * Safely parse JSON from Claude's response
 */
function safeParseJSON(text, context) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch (e2) {
        // noop
      }
    }

    console.warn(`    ⚠ Warning: Could not parse JSON from ${context}. Using raw text.`);
    return { _raw: text, _parseError: true };
  }
}

/**
 * Count approximate number of facts in a memory object
 */
function countFacts(memoryData) {
  if (!memoryData) return 0;
  let count = 0;
  function walk(obj) {
    if (typeof obj === 'string' && obj.length > 0) count++;
    else if (Array.isArray(obj)) obj.forEach(walk);
    else if (typeof obj === 'object' && obj !== null) Object.values(obj).forEach(walk);
  }
  walk(memoryData);
  return count;
}
