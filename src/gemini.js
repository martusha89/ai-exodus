/**
 * Gemini provider — free-tier friendly backend for AI Exodus
 *
 * Maps the {system, prompt, model} contract to Google's generateContent REST API.
 * Emits the SAME err.skipReason codes the analyzer relies on:
 *   'aup'             — content blocked by safety / policy (non-retryable)
 *   'context-too-big' — input exceeds the model's token limit (analyzer will split)
 *   'overloaded'      — surfaced only after internal retries are exhausted
 *
 * Free-tier rate limits (HTTP 429) are handled INTERNALLY with exponential backoff,
 * honouring Retry-After / retryDelay, so a transient per-minute cap never drops a
 * chunk. Only a hard, persistent failure bubbles up to the analyzer.
 *
 * No SDK, no dependency — uses Node 18+ global fetch.
 */

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Companion / relationship logs trip default safety filters constantly. This is
// the user's OWN data being analysed for the user — turn blocking off so we don't
// lose half the history to false positives.
const SAFETY_OFF = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
  'HARM_CATEGORY_CIVIC_INTEGRITY',
].map((category) => ({ category, threshold: 'BLOCK_NONE' }));

const MAX_RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function getApiKey(cfg) {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || cfg?.geminiApiKey || null;
}

/** 2s, 4s, 8s, 16s, 32s, capped at 60s */
function backoff(attempt) {
  return Math.min(2000 * 2 ** attempt, 60000);
}

/** Pull a wait hint from Retry-After header or the body's retryDelay ("37s") */
function retryAfterMs(res, errText) {
  const header = res.headers.get('retry-after');
  if (header) {
    const secs = parseInt(header, 10);
    if (!Number.isNaN(secs)) return Math.min(secs * 1000, 65000);
  }
  const m = (errText || '').match(/"retryDelay":\s*"(\d+)s"/);
  if (m) return Math.min(parseInt(m[1], 10) * 1000, 65000);
  return null;
}

/** Map a hard (non-retryable) HTTP failure to a skipReason, or null if unknown */
function classifyHttpError(status, bodyText) {
  const lower = (bodyText || '').toLowerCase();
  if (status === 400 && (lower.includes('token') || lower.includes('exceeds') ||
      lower.includes('too long') || lower.includes('size'))) {
    return 'context-too-big';
  }
  return null;
}

function extractText(data) {
  // Whole prompt rejected before generation
  if (data?.promptFeedback?.blockReason) {
    const err = new Error(`Gemini blocked the prompt: ${data.promptFeedback.blockReason}`);
    err.skipReason = 'aup';
    throw err;
  }
  const cand = data?.candidates?.[0];
  if (!cand) {
    // No candidate at all is almost always a safety block with empty payload
    const err = new Error('Gemini returned no candidates (likely safety block)');
    err.skipReason = 'aup';
    throw err;
  }
  const finish = cand.finishReason;
  if (finish && ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'].includes(finish)) {
    const err = new Error(`Gemini stopped for ${finish}`);
    err.skipReason = 'aup';
    throw err;
  }
  const text = (cand.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) {
    // Empty + non-safety: usually transient or truncation. Bubble as fatal (no
    // skipReason) so the run stops and resumes cleanly from checkpoint instead of
    // silently dropping the chunk.
    throw new Error(`Gemini returned empty text (finishReason=${finish || 'unknown'})`);
  }
  return text;
}

/**
 * Call Gemini. Retries 429/503 internally; throws with skipReason on hard failures.
 */
export async function callGemini({ system, prompt, model, apiKey, temperature, maxOutputTokens }) {
  if (!apiKey) {
    throw new Error(
      'Gemini API key not set. Get a free key at https://aistudio.google.com/apikey\n' +
      'then run:  ai-exodus config set gemini-key <KEY>'
    );
  }

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: temperature ?? 0.6,
      maxOutputTokens: maxOutputTokens ?? 8192,
    },
    safetySettings: SAFETY_OFF,
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const url = `${API_BASE}/models/${model}:generateContent`;
  let lastErr = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      // Network blip — back off and retry
      lastErr = netErr;
      if (attempt < MAX_RETRIES) { await sleep(backoff(attempt)); continue; }
      break;
    }

    if (res.ok) {
      return extractText(await res.json());
    }

    const errText = await res.text().catch(() => '');

    // Retryable: rate limit / transient overload — wait and try again
    if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES) {
      await sleep(retryAfterMs(res, errText) ?? backoff(attempt));
      continue;
    }

    const err = new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
    const reason = classifyHttpError(res.status, errText);
    if (reason) err.skipReason = reason;
    else if (res.status === 429 || res.status === 503) err.skipReason = 'overloaded';
    throw err;
  }

  const err = new Error(`Gemini API failed after ${MAX_RETRIES} retries: ${lastErr?.message || 'rate limited'}`);
  err.skipReason = 'overloaded';
  throw err;
}

/**
 * Preflight: confirm a key is present. A bad key fails clearly on first real call.
 */
export async function checkGemini(cfg) {
  const key = getApiKey(cfg);
  if (!key) {
    return {
      ok: false,
      error:
        'Gemini API key not set. Get a FREE key at https://aistudio.google.com/apikey\n' +
        '  then run:  ai-exodus config set gemini-key <KEY>\n' +
        '  (or set the GEMINI_API_KEY environment variable)',
    };
  }
  return { ok: true, version: 'Gemini (free-tier API)' };
}
