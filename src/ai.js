/**
 * Provider router — picks the analysis backend.
 *
 * Every backend honours one contract: callAI({system, prompt, model}) -> string,
 * and sets err.skipReason ('aup' | 'context-too-big' | 'overloaded') on failure so
 * the analyzer's chunk-splitting / skip logic works regardless of which backend ran.
 *
 * Selection order:
 *   1. EXODUS_PROVIDER env  (set by the --provider flag)
 *   2. config.provider      (~/.exodus/config.json)
 *   3. auto: a Gemini key present -> 'gemini'
 *   4. 'claude'             (default — preserves original behaviour)
 */

import { callClaude, checkCLI } from './claude.js';
import { callGemini, checkGemini, getApiKey } from './gemini.js';
import { loadConfig } from './config.js';

let _cfg = null;
async function cfg() {
  if (!_cfg) _cfg = await loadConfig();
  return _cfg;
}

/** Force a fresh config read (used after `config set` writes in the same process) */
export function resetConfigCache() { _cfg = null; }

export async function resolveProvider() {
  const c = await cfg();
  const explicit = (process.env.EXODUS_PROVIDER || c.provider || '').toLowerCase();
  if (explicit) return explicit;
  if (getApiKey(c)) return 'gemini';
  return 'claude';
}

/** Translate a Claude-style model name into a Gemini model id (config-overridable) */
function mapGeminiModel(model, c) {
  const main = c.geminiModel || 'gemini-2.0-flash';
  const fast = c.geminiModelFast || 'gemini-2.0-flash-lite';
  if (!model) return main;
  const m = String(model).toLowerCase();
  if (m.startsWith('gemini')) return model;            // already a Gemini id — pass through
  if (m.includes('haiku') || m.includes('lite')) return fast;
  return main;                                         // sonnet / opus / default
}

export async function callAI({ system, prompt, model }) {
  const provider = await resolveProvider();
  const c = await cfg();

  if (provider === 'gemini') {
    return callGemini({
      system,
      prompt,
      model: mapGeminiModel(model, c),
      apiKey: getApiKey(c),
      temperature: c.geminiTemperature,
      maxOutputTokens: c.geminiMaxTokens,
    });
  }

  // Default: Claude CLI — unchanged behaviour
  return callClaude({ system, prompt, model });
}

export async function checkProvider() {
  const provider = await resolveProvider();
  const c = await cfg();
  if (provider === 'gemini') {
    return { ...(await checkGemini(c)), provider: 'gemini' };
  }
  return { ...(await checkCLI()), provider: 'claude' };
}
