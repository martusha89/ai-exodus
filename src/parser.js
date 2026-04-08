/**
 * ChatGPT JSON + Raw Text parser
 * Handles 1GB+ files via streaming JSON parse
 */

import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';

/**
 * Detect format from file extension and content
 */
function detectFormat(filePath, firstBytes) {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') {
    // Check if it looks like ChatGPT export
    if (firstBytes.includes('"mapping"') || firstBytes.includes('"conversation_id"')) {
      return 'chatgpt';
    }
    return 'chatgpt'; // assume JSON = ChatGPT for now
  }
  if (ext === '.txt' || ext === '.md') return 'raw';
  if (ext === '.jsonl') return 'tavern'; // future
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
 */
export async function parse(filePath, options = {}) {
  const firstChunk = await readFile(filePath, { encoding: 'utf-8', length: 4096, position: 0 })
    .catch(() => '');

  const format = options.format || detectFormat(filePath, firstChunk);

  if (options.verbose) console.log(`    Detected format: ${format}`);

  switch (format) {
    case 'chatgpt':
      return parseChatGPT(filePath, options);
    case 'raw':
      return parseRaw(filePath, options.verbose);
    default:
      throw new Error(`Unsupported format: ${format}. Run 'ai-exodus formats' to see supported formats.`);
  }
}
