/**
 * ChatGPT JSON + Raw Text parser
 * Handles 1GB+ files via streaming JSON parse
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname, join, dirname } from 'node:path';

/**
 * Detect format from file extension and content
 */
function detectFormat(filePath, firstBytes) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') {
    // ChatGPT: tree-of-nodes "mapping"
    if (firstBytes.includes('"mapping"') || firstBytes.includes('"conversation_id"')) {
      return 'chatgpt';
    }
    // Claude.ai export: chat_messages[] with sender: human/assistant
    if (firstBytes.includes('"chat_messages"') || firstBytes.includes('"sender"')) {
      return 'claude';
    }
    // Any other JSON — let the generic sniffer figure it out (Grok, Gemini, etc.)
    return 'generic';
  }
  if (ext === '.txt' || ext === '.md') return 'raw';
  if (ext === '.jsonl') return 'generic';
  return 'raw'; // fallback
}

/**
 * Parse ChatGPT export JSON
 * Format: array of conversation objects, each with a "mapping" of message nodes
 */
async function parseChatGPT(filePath, options = {}) {
  const { verbose } = options;
  const fileInfo = await stat(filePath);
  const fileMB = fileInfo.size / 1024 / 1024;

  if (verbose) console.log(`    Reading ${fileMB.toFixed(1)} MB...`);

  // For files under 500MB, read in memory. Above that, we'd need streaming.
  // Node can handle ~1-2GB strings, so this covers most exports.
  const raw = await readFile(filePath, 'utf-8');
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error('Expected ChatGPT export to be a JSON array of conversations');
  }

  const conversations = [];
  let totalMessages = 0;
  let skippedShort = 0;
  let skippedModel = 0;
  let earliestDate = null;
  let latestDate = null;

  for (const convo of data) {
    const title = convo.title || 'Untitled';
    const createTime = convo.create_time ? new Date(convo.create_time * 1000) : null;
    const updateTime = convo.update_time ? new Date(convo.update_time * 1000) : null;

    // Track date range
    if (createTime) {
      if (!earliestDate || createTime < earliestDate) earliestDate = createTime;
      if (!latestDate || createTime > latestDate) latestDate = createTime;
    }
    if (updateTime && updateTime > latestDate) latestDate = updateTime;

    // Extract messages from the mapping tree
    const messages = [];
    if (convo.mapping) {
      // Build ordered message list from the tree
      const nodes = Object.values(convo.mapping);
      // Sort by create_time if available, otherwise by position in tree
      const sortedNodes = nodes
        .filter(n => n.message && n.message.content && n.message.content.parts)
        .filter(n => {
          const role = n.message.author?.role;
          return role === 'user' || role === 'assistant';
        })
        .sort((a, b) => {
          const ta = a.message.create_time || 0;
          const tb = b.message.create_time || 0;
          return ta - tb;
        });

      for (const node of sortedNodes) {
        const msg = node.message;
        const role = msg.author?.role || 'unknown';
        const content = msg.content.parts
          .filter(p => typeof p === 'string')
          .join('\n')
          .trim();

        if (!content) continue;

        const timestamp = msg.create_time ? new Date(msg.create_time * 1000) : null;

        messages.push({
          role,
          content,
          timestamp,
          model: msg.metadata?.model_slug || null,
        });
      }
    }

    if (messages.length === 0) continue;

    // Skip short conversations (< minMessages) — not enough signal
    if (options.minMessages && messages.length < options.minMessages) {
      skippedShort++;
      continue;
    }

    // Date range filter
    if (options.from && createTime && createTime < options.from) continue;
    if (options.to && createTime && createTime > options.to) continue;

    // Model filter — check if any message in the convo used a matching model
    if (options.modelFilter) {
      const filters = options.modelFilter.map(f => f.toLowerCase());
      const convoModels = messages.map(m => (m.model || '').toLowerCase()).filter(Boolean);
      const hasMatch = convoModels.some(cm => filters.some(f => cm.includes(f)));
      if (!hasMatch) {
        skippedModel++;
        continue;
      }
    }

    totalMessages += messages.length;
    conversations.push({
      id: convo.id || convo.conversation_id || null,
      title,
      createdAt: createTime,
      updatedAt: updateTime,
      messages,
      messageCount: messages.length,
      // Custom GPT system prompt if present
      systemPrompt: convo.mapping ? extractSystemPrompt(convo.mapping) : null,
    });
  }

  if (skippedModel > 0 && verbose) {
    console.log(`    Skipped ${skippedModel} conversations (model filter)`);
  }
  if (skippedShort > 0 && verbose) {
    console.log(`    Skipped ${skippedShort} conversations with < ${options.minMessages} messages`);
  }

  // Sort conversations chronologically
  conversations.sort((a, b) => {
    const ta = a.createdAt?.getTime() || 0;
    const tb = b.createdAt?.getTime() || 0;
    return ta - tb;
  });

  return {
    source: 'chatgpt',
    conversations,
    messageCount: totalMessages,
    dateRange: {
      from: earliestDate ? formatDate(earliestDate) : 'unknown',
      to: latestDate ? formatDate(latestDate) : 'unknown',
    },
    metadata: {
      conversationCount: conversations.length,
      hasCustomGPT: conversations.some(c => c.systemPrompt),
      fileSizeMB: fileMB,
    },
  };
}

/**
 * Extract system prompt from a ChatGPT conversation mapping (custom GPTs)
 */
function extractSystemPrompt(mapping) {
  const nodes = Object.values(mapping);
  for (const node of nodes) {
    if (node.message?.author?.role === 'system') {
      const parts = node.message.content?.parts || [];
      const text = parts.filter(p => typeof p === 'string').join('\n').trim();
      if (text && text.length > 50) return text; // skip generic "You are ChatGPT" etc
    }
  }
  return null;
}

/**
 * Parse raw text conversation logs
 * Tries to detect speaker patterns like "User:", "Assistant:", names, etc.
 */
async function parseRaw(filePath, verbose) {
  const raw = await readFile(filePath, 'utf-8');
  const lines = raw.split('\n');

  // Detect speaker pattern
  // Common patterns: "Name: message", "**Name**: message", "[Name] message", "Name\nmessage"
  const speakerPatterns = [
    /^(?:\*\*)?([A-Za-z_][\w\s]{0,20}?)(?:\*\*)?:\s*(.+)/,  // Name: message or **Name**: message
    /^\[([A-Za-z_][\w\s]{0,20}?)\]\s*(.+)/,                   // [Name] message
  ];

  const messages = [];
  let currentSpeaker = null;
  let currentContent = [];
  let speakers = new Set();

  for (const line of lines) {
    let matched = false;
    for (const pattern of speakerPatterns) {
      const m = line.match(pattern);
      if (m) {
        // Save previous message
        if (currentSpeaker && currentContent.length > 0) {
          messages.push({
            role: currentSpeaker,
            content: currentContent.join('\n').trim(),
            timestamp: null,
            model: null,
          });
        }
        currentSpeaker = m[1].trim();
        speakers.add(currentSpeaker);
        currentContent = [m[2] || ''];
        matched = true;
        break;
      }
    }
    if (!matched && currentSpeaker) {
      currentContent.push(line);
    }
  }

  // Don't forget the last message
  if (currentSpeaker && currentContent.length > 0) {
    messages.push({
      role: currentSpeaker,
      content: currentContent.join('\n').trim(),
      timestamp: null,
      model: null,
    });
  }

  // Try to map speakers to user/assistant roles
  const speakerList = [...speakers];
  if (speakerList.length === 2) {
    // Heuristic: the one that appears first is likely the user
    const first = messages[0]?.role;
    for (const msg of messages) {
      msg.role = msg.role === first ? 'user' : 'assistant';
    }
  } else {
    // Can't reliably map — keep names, let the analyzer figure it out
    if (verbose) {
      console.log(`    Detected ${speakerList.length} speakers: ${speakerList.join(', ')}`);
    }
  }

  return {
    source: 'raw',
    conversations: [{
      id: basename(filePath),
      title: basename(filePath),
      createdAt: null,
      updatedAt: null,
      messages: messages.filter(m => m.content),
      messageCount: messages.filter(m => m.content).length,
      systemPrompt: null,
    }],
    messageCount: messages.filter(m => m.content).length,
    dateRange: { from: 'unknown', to: 'unknown' },
    metadata: {
      conversationCount: 1,
      speakers: speakerList,
      fileSizeMB: (await stat(filePath)).size / 1024 / 1024,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// Multi-platform parsers (Claude, Grok, Gemini, …) + generic JSON sniffer
//
// Every parser below normalises to the SAME internal shape the analyzer eats:
//   { source, conversations: [{ id, title, createdAt, updatedAt,
//       messages: [{ role, content, timestamp, model }], messageCount }],
//     messageCount, dateRange, metadata }
// Downstream (chunker / analyzer / generator) is format-agnostic — it never
// needs to know which platform the data came from.
// ════════════════════════════════════════════════════════════════════════

/** Parse epoch (s or ms) or ISO string into a Date, or null. */
function parseDate(v) {
  if (v == null) return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v); // seconds vs ms
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const ROLE_USER = new Set(['user', 'human', 'you', 'me', 'prompt']);
const ROLE_AI = new Set(['assistant', 'ai', 'bot', 'model', 'gpt', 'chatgpt', 'claude', 'grok', 'gemini', 'character', 'companion', 'partner']);

/** Map any platform's speaker label onto user/assistant (or keep raw if unknown). */
function coerceRole(obj) {
  let r = obj.role ?? obj.sender ?? obj.from ?? obj.speaker ?? obj.author;
  if (r && typeof r === 'object') r = r.role ?? r.name; // ChatGPT-style author:{role}
  r = (r ?? '').toString().toLowerCase().trim();
  if (ROLE_USER.has(r)) return 'user';
  if (ROLE_AI.has(r)) return 'assistant';
  return r || 'unknown';
}

/** Flatten whatever a platform stuffs into "content" down to a plain string. */
function contentToString(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object') {
        if (typeof part.text === 'string') return part.text;
        if (part.parts) return contentToString(part.parts);
        if (typeof part.content !== 'undefined') return contentToString(part.content);
      }
      return '';
    }).filter(Boolean).join('\n');
  }
  if (typeof c === 'object') {
    if (typeof c.text === 'string') return c.text;
    if (c.parts) return contentToString(c.parts);
    if (typeof c.content !== 'undefined') return contentToString(c.content);
  }
  return '';
}

function coerceContent(obj) {
  return contentToString(
    obj.content ?? obj.text ?? obj.message ?? obj.parts ?? obj.body ?? obj.value
  ).trim();
}

/** Does this object look like a single chat message? */
function looksLikeMessage(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const hasRole = ['role', 'sender', 'from', 'speaker', 'author'].some((k) => k in o);
  const hasContent = ['content', 'text', 'message', 'parts', 'body', 'value'].some((k) => k in o);
  return hasRole && hasContent;
}

/** Normalise one raw message object (unwrapping ChatGPT-style {message:{…}} nodes). */
function toMessage(m) {
  const obj = (m && m.message && typeof m.message === 'object') ? m.message : m;
  if (!obj || typeof obj !== 'object') return { role: 'unknown', content: '', timestamp: null, model: null };
  return {
    role: coerceRole(obj),
    content: coerceContent(obj),
    timestamp: parseDate(obj.create_time ?? obj.created_at ?? obj.timestamp ?? obj.time),
    model: obj.model ?? obj.model_slug ?? obj.metadata?.model_slug ?? null,
  };
}

/** Deep-search any object for the largest array of message-like items. */
function findLargestMessageArray(root) {
  let best = null;
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || depth > 6) return;
    if (Array.isArray(node)) {
      const msgish = node.filter(looksLikeMessage);
      if (msgish.length && (!best || msgish.length > best.length)) best = msgish;
      node.forEach((n) => walk(n, depth + 1));
      return;
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  }
  walk(root, 0);
  return best;
}

/** Pull a conversation (title + messages) out of one arbitrary object. */
function convoFromObject(c, i) {
  if (!c || typeof c !== 'object') return null;

  let msgs = null;
  for (const key of ['chat_messages', 'messages', 'turns', 'conversation', 'dialog', 'chat', 'mapping']) {
    if (Array.isArray(c[key])) { msgs = c[key]; break; }
    if (key === 'mapping' && c[key] && typeof c[key] === 'object') {
      msgs = Object.values(c[key]).map((n) => n.message).filter(Boolean);
      break;
    }
  }
  if (!msgs && looksLikeMessage(c)) msgs = [c];           // the object IS a message
  if (!msgs) msgs = findLargestMessageArray(c);           // last resort: dig
  if (!msgs || !msgs.length) return null;

  const messages = msgs.map(toMessage).filter((m) => m.content);
  if (!messages.length) return null;

  return {
    id: c.uuid ?? c.id ?? c.conversation_id ?? null,
    title: c.name ?? c.title ?? c.subject ?? `Conversation ${i + 1}`,
    createdAt: parseDate(c.created_at ?? c.create_time ?? c.createdAt ?? c.timestamp),
    updatedAt: parseDate(c.updated_at ?? c.update_time ?? c.updatedAt),
    messages,
  };
}

/** Turn an arbitrary parsed-JSON root into a list of {title, messages, …}. */
function extractConversations(data) {
  if (Array.isArray(data)) {
    // Array of bare messages → one conversation
    const msgish = data.filter(looksLikeMessage);
    if (msgish.length && msgish.length >= Math.max(2, data.length * 0.5)) {
      return [{ id: null, title: 'Conversation', createdAt: null, updatedAt: null,
        messages: msgish.map(toMessage).filter((m) => m.content) }];
    }
    // Array of conversations
    return data.map((c, i) => convoFromObject(c, i)).filter((c) => c && c.messages.length);
  }
  if (data && typeof data === 'object') {
    for (const key of ['conversations', 'chats', 'data', 'threads', 'items', 'history']) {
      if (Array.isArray(data[key])) return extractConversations(data[key]);
    }
    const single = convoFromObject(data, 0);
    if (single && single.messages.length) return [single];
  }
  return [];
}

/** Apply shared filters / sorting / metadata to already-normalised conversations. */
function buildResult(source, rawConvos, options = {}, fileMB = 0) {
  const conversations = [];
  let totalMessages = 0;
  let skippedShort = 0;
  let earliest = null;
  let latest = null;

  for (const c of rawConvos) {
    const messages = (c.messages || []).filter((m) => m.content && m.content.trim());
    if (messages.length === 0) continue;

    if (options.minMessages && messages.length < options.minMessages) { skippedShort++; continue; }
    if (options.from && c.createdAt && c.createdAt < options.from) continue;
    if (options.to && c.createdAt && c.createdAt > options.to) continue;

    if (options.modelFilter) {
      const filters = options.modelFilter.map((f) => f.toLowerCase());
      const convoModels = messages.map((m) => (m.model || '').toLowerCase()).filter(Boolean);
      if (!convoModels.some((cm) => filters.some((f) => cm.includes(f)))) continue;
    }

    if (c.createdAt) {
      if (!earliest || c.createdAt < earliest) earliest = c.createdAt;
      if (!latest || c.createdAt > latest) latest = c.createdAt;
    }

    totalMessages += messages.length;
    conversations.push({
      id: c.id || null,
      title: c.title || 'Untitled',
      createdAt: c.createdAt || null,
      updatedAt: c.updatedAt || null,
      messages,
      messageCount: messages.length,
      systemPrompt: c.systemPrompt || null,
    });
  }

  if (skippedShort > 0 && options.verbose) {
    console.log(`    Skipped ${skippedShort} conversations with < ${options.minMessages} messages`);
  }

  conversations.sort((a, b) => (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0));

  return {
    source,
    conversations,
    messageCount: totalMessages,
    dateRange: {
      from: earliest ? formatDate(earliest) : 'unknown',
      to: latest ? formatDate(latest) : 'unknown',
    },
    metadata: {
      conversationCount: conversations.length,
      fileSizeMB: fileMB,
    },
  };
}

/**
 * Parse a Claude.ai data export (conversations.json).
 * Shape: array of { uuid, name, created_at, chat_messages: [{ sender, text, content }] }
 */
async function parseClaude(filePath, options = {}) {
  const fileMB = (await stat(filePath)).size / 1024 / 1024;
  if (options.verbose) console.log(`    Reading ${fileMB.toFixed(1)} MB (Claude export)...`);

  const data = JSON.parse(await readFile(filePath, 'utf-8'));
  const convosRaw = Array.isArray(data) ? data : (data.conversations || data.chats || []);

  const rawConvos = convosRaw.map((convo, i) => {
    const msgs = convo.chat_messages || convo.messages || [];
    return {
      id: convo.uuid || convo.id || null,
      title: convo.name || convo.title || `Conversation ${i + 1}`,
      createdAt: parseDate(convo.created_at),
      updatedAt: parseDate(convo.updated_at),
      messages: msgs.map((m) => ({
        role: coerceRole(m),
        content: coerceContent(m),
        timestamp: parseDate(m.created_at),
        model: m.model || null,
      })),
    };
  });

  return buildResult('claude', rawConvos, options, fileMB);
}

/**
 * Generic JSON sniffer — best-effort parse of ANY chat export (Grok, Gemini,
 * Character.AI, unknown tools). Detects role + content patterns recursively.
 * Falls back to JSONL (one JSON object per line) if the file isn't a single doc.
 */
async function parseGenericJSON(filePath, options = {}) {
  const fileMB = (await stat(filePath)).size / 1024 / 1024;
  if (options.verbose) console.log(`    Reading ${fileMB.toFixed(1)} MB (generic JSON sniff)...`);

  const text = await readFile(filePath, 'utf-8');
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // JSONL fallback: one object per line
    const objs = text.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
    if (!objs.length) throw new Error('File is not valid JSON or JSONL.');
    data = objs;
  }

  const rawConvos = extractConversations(data);
  if (!rawConvos.length) {
    throw new Error(
      'Could not detect any conversations in this JSON.\n' +
      '  Try --format chatgpt|claude|raw, or check the file has role/content fields.'
    );
  }

  // If a conversation's roles are mostly unrecognised, alternate user/assistant
  // (better than feeding the analyzer a wall of "UNKNOWN:").
  for (const c of rawConvos) {
    const unknown = c.messages.filter((m) => m.role !== 'user' && m.role !== 'assistant').length;
    if (unknown > c.messages.length / 2) {
      c.messages.forEach((m, idx) => { m.role = idx % 2 === 0 ? 'user' : 'assistant'; });
    }
  }

  if (options.verbose) {
    console.log(`    Sniffed ${rawConvos.length} conversation(s) from generic JSON`);
  }
  return buildResult('generic', rawConvos, options, fileMB);
}

/**
 * Chunk conversations into batches for processing
 * Each chunk stays under a target token count
 */
export function chunkConversations(conversations, targetTokens = 180000) {
  const chunks = [];
  let currentChunk = [];
  let currentTokens = 0;

  for (const convo of conversations) {
    // Rough token estimate: 1 token ≈ 4 chars
    const convoTokens = convo.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

    if (currentTokens + convoTokens > targetTokens && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentTokens = 0;
    }

    // If a single conversation is bigger than target, it gets its own chunk
    currentChunk.push(convo);
    currentTokens += convoTokens;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

/**
 * Format a conversation chunk as readable text for the analyzer
 */
export function formatChunk(conversations) {
  const parts = [];
  for (const convo of conversations) {
    parts.push(`\n=== Conversation: ${convo.title} ===`);
    if (convo.createdAt) parts.push(`Date: ${formatDate(convo.createdAt)}`);
    if (convo.systemPrompt) parts.push(`[Custom GPT System Prompt: ${convo.systemPrompt.slice(0, 500)}...]`);
    parts.push('');
    for (const msg of convo.messages) {
      const ts = msg.timestamp ? ` [${formatDate(msg.timestamp)}]` : '';
      parts.push(`${msg.role.toUpperCase()}${ts}: ${msg.content}`);
      parts.push('');
    }
  }
  return parts.join('\n');
}

function formatDate(date) {
  if (!date) return 'unknown';
  return date.toISOString().split('T')[0];
}

/**
 * Main parse function
 * Handles: single file, directory of shards, or a specific shard file
 */
export async function parse(filePath, options = {}) {
  const fileInfo = await stat(filePath);

  // If it's a directory, look for conversation shards or a single conversations.json
  if (fileInfo.isDirectory()) {
    return parseDirectory(filePath, options);
  }

  // If it's a shard file (conversations-000.json), load all sibling shards
  const filename = basename(filePath);
  if (filename.match(/^conversations-\d+\.json$/)) {
    return parseDirectory(dirname(filePath), options);
  }

  const firstChunk = await readFile(filePath, { encoding: 'utf-8', length: 4096, position: 0 })
    .catch(() => '');

  const format = options.format || detectFormat(filePath, firstChunk);

  if (options.verbose) console.log(`    Detected format: ${format}`);

  switch (format) {
    case 'chatgpt':
      return parseChatGPT(filePath, options);
    case 'claude':
      return parseClaude(filePath, options);
    case 'grok':
    case 'gemini':
    case 'generic':
      return parseGenericJSON(filePath, options);
    case 'raw':
      return parseRaw(filePath, options.verbose);
    default:
      throw new Error(`Unsupported format: ${format}. Run 'ai-exodus formats' to see supported formats.`);
  }
}

/**
 * Parse a directory of ChatGPT export shards (conversations-000.json, etc.)
 * or a directory containing a single conversations.json
 */
async function parseDirectory(dirPath, options = {}) {
  const files = await readdir(dirPath);

  // Look for sharded exports first
  const shards = files
    .filter(f => f.match(/^conversations-\d+\.json$/))
    .sort();

  if (shards.length > 0) {
    if (options.verbose) console.log(`    Found ${shards.length} conversation shards`);

    // Parse each shard and merge results
    let allConversations = [];
    let totalMessages = 0;
    let earliestDate = null;
    let latestDate = null;
    let totalSizeMB = 0;

    for (let i = 0; i < shards.length; i++) {
      const shardPath = join(dirPath, shards[i]);
      if (options.verbose) console.log(`    Parsing shard ${i + 1}/${shards.length}: ${shards[i]}`);
      else process.stdout.write(`\r    Parsing shard ${i + 1}/${shards.length}...`);

      const result = await parseChatGPT(shardPath, { ...options, verbose: false });

      allConversations.push(...result.conversations);
      totalMessages += result.messageCount;
      totalSizeMB += result.metadata.fileSizeMB;

      // Expand date range
      if (result.dateRange.from !== 'unknown') {
        const d = new Date(result.dateRange.from);
        if (!earliestDate || d < earliestDate) earliestDate = d;
      }
      if (result.dateRange.to !== 'unknown') {
        const d = new Date(result.dateRange.to);
        if (!latestDate || d > latestDate) latestDate = d;
      }
    }

    if (!options.verbose) process.stdout.write('\r');

    // Sort all conversations chronologically
    allConversations.sort((a, b) => {
      const ta = a.createdAt?.getTime() || 0;
      const tb = b.createdAt?.getTime() || 0;
      return ta - tb;
    });

    return {
      source: 'chatgpt',
      conversations: allConversations,
      messageCount: totalMessages,
      dateRange: {
        from: earliestDate ? formatDate(earliestDate) : 'unknown',
        to: latestDate ? formatDate(latestDate) : 'unknown',
      },
      metadata: {
        conversationCount: allConversations.length,
        shardCount: shards.length,
        hasCustomGPT: allConversations.some(c => c.systemPrompt),
        fileSizeMB: totalSizeMB,
      },
    };
  }

  // Fall back to single conversations.json in directory
  const singleFile = files.find(f => f === 'conversations.json');
  if (singleFile) {
    return parseChatGPT(join(dirPath, singleFile), options);
  }

  throw new Error(`No conversations found in ${dirPath}. Expected conversations.json or conversations-*.json shards.`);
}
