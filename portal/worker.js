/**
 * AI Exodus Portal — Cloudflare Worker
 * Personal chat archive + analysis dashboard
 * Single-file architecture: API + embedded HTML/CSS/JS
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // ── CORS preflight ──
    if (method === 'OPTIONS') return corsResponse();

    // ── Auth check (cookie-based, same as Hearth/Fieldwork) ──
    const isAPI = path.startsWith('/api/');
    const isMCP = path.startsWith('/mcp/');
    const isSetup = path === '/setup';
    const isLogin = path === '/login';
    const isAsset = path.startsWith('/assets/');

    // MCP auth is via secret in path
    if (isMCP) return handleMCP(request, env, path);

    // Check if password is set
    const pw = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('password').first();
    if (!pw && !isSetup) {
      if (isAPI) return json({ error: 'Setup required' }, 401);
      return htmlResponse(setupPage());
    }

    // Setup endpoint
    if (isSetup && method === 'POST') return handleSetup(request, env);

    // Login endpoint
    if (isLogin && method === 'POST') return handleLogin(request, env, pw?.value);

    // Auth check for everything else
    if (pw) {
      const cookie = parseCookies(request.headers.get('Cookie') || '');
      const session = cookie['exodus_session'];
      if (session !== pw.value) {
        if (isAPI) return json({ error: 'Unauthorized' }, 401);
        return htmlResponse(loginPage());
      }
    }

    // ── API Routes ──
    if (isAPI) {
      try {
        // Conversations
        if (path === '/api/conversations' && method === 'GET') return getConversations(request, env);
        if (path === '/api/conversations/search' && method === 'GET') return searchConversations(request, env);
        if (path.match(/^\/api\/conversations\/[^/]+$/) && method === 'GET') return getConversation(request, env, path.split('/')[3]);
        if (path.match(/^\/api\/conversations\/[^/]+$/) && method === 'DELETE') return deleteConversation(env, path.split('/')[3]);

        // Messages
        if (path.match(/^\/api\/conversations\/[^/]+\/messages$/) && method === 'GET') return getMessages(request, env, path.split('/')[3]);

        // Skills (CRUD)
        if (path === '/api/skills' && method === 'GET') return getSkills(env);
        if (path === '/api/skills' && method === 'POST') return createSkill(request, env);
        if (path.match(/^\/api\/skills\/\d+$/) && method === 'PUT') return updateSkill(request, env, path.split('/')[3]);
        if (path.match(/^\/api\/skills\/\d+$/) && method === 'DELETE') return deleteSkill(env, path.split('/')[3]);

        // Skill categories (CRUD)
        if (path === '/api/skill-categories' && method === 'GET') return getSkillCategories(env);
        if (path === '/api/skill-categories' && method === 'POST') return createSkillCategory(request, env);
        if (path.match(/^\/api\/skill-categories\/\d+$/) && method === 'PUT') return updateSkillCategory(request, env, path.split('/')[3]);
        if (path.match(/^\/api\/skill-categories\/\d+$/) && method === 'DELETE') return deleteSkillCategory(env, path.split('/')[3]);

        // Memories (CRUD)
        if (path === '/api/memories' && method === 'GET') return getMemories(request, env);
        if (path === '/api/memories' && method === 'POST') return createMemory(request, env);
        if (path.match(/^\/api\/memories\/\d+$/) && method === 'PUT') return updateMemory(request, env, path.split('/')[3]);
        if (path.match(/^\/api\/memories\/\d+$/) && method === 'DELETE') return deleteMemory(env, path.split('/')[3]);

        // Memory categories (CRUD)
        if (path === '/api/memory-categories' && method === 'GET') return getMemoryCategories(env);
        if (path === '/api/memory-categories' && method === 'POST') return createMemoryCategory(request, env);
        if (path.match(/^\/api\/memory-categories\/\d+$/) && method === 'PUT') return updateMemoryCategory(request, env, path.split('/')[3]);
        if (path.match(/^\/api\/memory-categories\/\d+$/) && method === 'DELETE') return deleteMemoryCategory(env, path.split('/')[3]);

        // Persona
        if (path === '/api/persona' && method === 'GET') return getPersona(env);
        if (path === '/api/persona' && method === 'PUT') return updatePersona(request, env);

        // Narrative
        if (path === '/api/narrative' && method === 'GET') return getNarrative(env);

        // Analysis runs
        if (path === '/api/runs' && method === 'GET') return getAnalysisRuns(env);

        // Stats
        if (path === '/api/stats' && method === 'GET') return getStats(env);

        // Analytics
        if (path === '/api/analytics' && method === 'GET') return getAnalytics(env);

        // Import (for CLI to push data)
        if (path === '/api/import/conversations' && method === 'POST') return importConversations(request, env);
        if (path === '/api/import/analysis' && method === 'POST') return importAnalysis(request, env);

        // Settings
        if (path === '/api/settings' && method === 'GET') return getSettings(env);
        if (path === '/api/settings' && method === 'PUT') return updateSettings(request, env);

        return json({ error: 'Not found' }, 404);
      } catch (err) {
        return json({ error: err.message }, 500);
      }
    }

    // ── Serve portal HTML ──
    return htmlResponse(portalPage());
  }
};


// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════

async function handleSetup(request, env) {
  const body = await request.json();
  if (!body.password || body.password.length < 6) {
    return json({ error: 'Password must be at least 6 characters' }, 400);
  }
  await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('password', body.password).run();
  if (body.aiName) await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('ai_name', body.aiName).run();
  if (body.userName) await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind('user_name', body.userName).run();
  return json({ ok: true }, 200, { 'Set-Cookie': `exodus_session=${body.password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
}

async function handleLogin(request, env, password) {
  const body = await request.json();
  if (body.password !== password) return json({ error: 'Wrong password' }, 401);
  return json({ ok: true }, 200, { 'Set-Cookie': `exodus_session=${password}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000` });
}


// ═══════════════════════════════════════════
// CONVERSATIONS
// ═══════════════════════════════════════════

async function getConversations(request, env) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const offset = (page - 1) * limit;
  const source = url.searchParams.get('source');
  const model = url.searchParams.get('model');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let where = [];
  let params = [];
  if (source) { where.push('source = ?'); params.push(source); }
  if (model) { where.push('(model = ? OR id IN (SELECT DISTINCT conversation_id FROM messages WHERE model = ?))'); params.push(model, model); }
  if (from) { where.push('created_at >= ?'); params.push(from); }
  if (to) { where.push('created_at <= ?'); params.push(to); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const total = await env.DB.prepare(`SELECT COUNT(*) as count FROM conversations ${whereClause}`).bind(...params).first();
  const rows = await env.DB.prepare(`SELECT * FROM conversations ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();

  return json({
    conversations: rows.results,
    total: total.count,
    page,
    pages: Math.ceil(total.count / limit),
  });
}

async function searchConversations(request, env) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q') || '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q.trim()) return json({ results: [] });

  const results = await env.DB.prepare(`
    SELECT m.conversation_id, m.content, m.role, m.model, m.created_at, c.title
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE m.content LIKE ?
    ORDER BY m.created_at DESC
    LIMIT ?
  `).bind(`%${q}%`, limit).all();

  return json({ results: results.results, query: q });
}

async function getConversation(request, env, id) {
  const convo = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
  if (!convo) return json({ error: 'Not found' }, 404);
  return json(convo);
}

async function deleteConversation(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(id),
    env.DB.prepare('DELETE FROM conversations WHERE id = ?').bind(id),
  ]);
  return json({ ok: true });
}

async function getMessages(request, env, conversationId) {
  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 500);
  const offset = (page - 1) * limit;

  const rows = await env.DB.prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY position ASC LIMIT ? OFFSET ?').bind(conversationId, limit, offset).all();
  const total = await env.DB.prepare('SELECT COUNT(*) as count FROM messages WHERE conversation_id = ?').bind(conversationId).first();

  return json({ messages: rows.results, total: total.count, page });
}


// ═══════════════════════════════════════════
// SKILLS (CRUD)
// ═══════════════════════════════════════════

async function getSkills(env) {
  const rows = await env.DB.prepare('SELECT * FROM skills ORDER BY category, name').all();
  return json(rows.results.map(parseSkillRow));
}

async function createSkill(request, env) {
  const s = await request.json();
  const result = await env.DB.prepare(`
    INSERT INTO skills (name, category, frequency, description, approach, quality, activation_rule, triggers_phrases, triggers_temporal, triggers_emotional, triggers_contextual, examples, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    s.name, s.category || 'other', s.frequency || 'occasional',
    s.description || '', s.approach || '', s.quality || '',
    s.activationRule || '',
    JSON.stringify(s.triggers?.phrases || []),
    JSON.stringify(s.triggers?.temporal || []),
    JSON.stringify(s.triggers?.emotional || []),
    JSON.stringify(s.triggers?.contextual || []),
    JSON.stringify(s.examples || []),
    s.source || 'manual'
  ).run();
  return json({ ok: true, id: result.meta.last_row_id });
}

async function updateSkill(request, env, id) {
  const s = await request.json();
  await env.DB.prepare(`
    UPDATE skills SET name = ?, category = ?, frequency = ?, description = ?, approach = ?, quality = ?,
    activation_rule = ?, triggers_phrases = ?, triggers_temporal = ?, triggers_emotional = ?, triggers_contextual = ?,
    examples = ?, updated_at = datetime('now')
    WHERE id = ?
  `).bind(
    s.name, s.category, s.frequency,
    s.description || '', s.approach || '', s.quality || '',
    s.activationRule || '',
    JSON.stringify(s.triggers?.phrases || []),
    JSON.stringify(s.triggers?.temporal || []),
    JSON.stringify(s.triggers?.emotional || []),
    JSON.stringify(s.triggers?.contextual || []),
    JSON.stringify(s.examples || []),
    id
  ).run();
  return json({ ok: true });
}

async function deleteSkill(env, id) {
  await env.DB.prepare('DELETE FROM skills WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

function parseSkillRow(row) {
  return {
    ...row,
    triggers: {
      phrases: safeJSON(row.triggers_phrases),
      temporal: safeJSON(row.triggers_temporal),
      emotional: safeJSON(row.triggers_emotional),
      contextual: safeJSON(row.triggers_contextual),
    },
    activationRule: row.activation_rule,
    examples: safeJSON(row.examples),
  };
}


// ═══════════════════════════════════════════
// SKILL CATEGORIES (CRUD)
// ═══════════════════════════════════════════

async function getSkillCategories(env) {
  const rows = await env.DB.prepare('SELECT * FROM skill_categories ORDER BY sort_order').all();
  return json(rows.results);
}

async function createSkillCategory(request, env) {
  const body = await request.json();
  const result = await env.DB.prepare('INSERT INTO skill_categories (name, color, icon, sort_order) VALUES (?, ?, ?, ?)')
    .bind(body.name, body.color || '#8b5cf6', body.icon || '', body.sortOrder || 99).run();
  return json({ ok: true, id: result.meta.last_row_id });
}

async function updateSkillCategory(request, env, id) {
  const body = await request.json();
  await env.DB.prepare('UPDATE skill_categories SET name = ?, color = ?, icon = ? WHERE id = ? AND is_default = 0')
    .bind(body.name, body.color, body.icon || '', id).run();
  return json({ ok: true });
}

async function deleteSkillCategory(env, id) {
  // Don't delete defaults
  const cat = await env.DB.prepare('SELECT is_default FROM skill_categories WHERE id = ?').bind(id).first();
  if (cat?.is_default) return json({ error: 'Cannot delete default category' }, 400);
  await env.DB.prepare('DELETE FROM skill_categories WHERE id = ?').bind(id).run();
  return json({ ok: true });
}


// ═══════════════════════════════════════════
// MEMORIES (CRUD)
// ═══════════════════════════════════════════

async function getMemories(request, env) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  let query = 'SELECT * FROM memories';
  let params = [];
  if (category) { query += ' WHERE category = ?'; params.push(category); }
  query += ' ORDER BY category, key';
  const rows = await env.DB.prepare(query).bind(...params).all();
  return json(rows.results);
}

async function createMemory(request, env) {
  const m = await request.json();
  const result = await env.DB.prepare('INSERT INTO memories (category, key, value, confidence, source) VALUES (?, ?, ?, ?, ?)')
    .bind(m.category || 'facts', m.key || null, m.value, m.confidence || 'manual', m.source || 'manual').run();
  return json({ ok: true, id: result.meta.last_row_id });
}

async function updateMemory(request, env, id) {
  const m = await request.json();
  await env.DB.prepare('UPDATE memories SET category = ?, key = ?, value = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(m.category, m.key, m.value, id).run();
  return json({ ok: true });
}

async function deleteMemory(env, id) {
  await env.DB.prepare('DELETE FROM memories WHERE id = ?').bind(id).run();
  return json({ ok: true });
}


// ═══════════════════════════════════════════
// MEMORY CATEGORIES (CRUD)
// ═══════════════════════════════════════════

async function getMemoryCategories(env) {
  const rows = await env.DB.prepare('SELECT * FROM memory_categories ORDER BY sort_order').all();
  return json(rows.results);
}

async function createMemoryCategory(request, env) {
  const body = await request.json();
  const result = await env.DB.prepare('INSERT INTO memory_categories (name, color, icon, sort_order) VALUES (?, ?, ?, ?)')
    .bind(body.name, body.color || '#8b5cf6', body.icon || '', body.sortOrder || 99).run();
  return json({ ok: true, id: result.meta.last_row_id });
}

async function updateMemoryCategory(request, env, id) {
  const body = await request.json();
  await env.DB.prepare('UPDATE memory_categories SET name = ?, color = ?, icon = ? WHERE id = ? AND is_default = 0')
    .bind(body.name, body.color, body.icon || '', id).run();
  return json({ ok: true });
}

async function deleteMemoryCategory(env, id) {
  const cat = await env.DB.prepare('SELECT is_default FROM memory_categories WHERE id = ?').bind(id).first();
  if (cat?.is_default) return json({ error: 'Cannot delete default category' }, 400);
  await env.DB.prepare('DELETE FROM memory_categories WHERE id = ?').bind(id).run();
  return json({ ok: true });
}


// ═══════════════════════════════════════════
// PERSONA
// ═══════════════════════════════════════════

async function getPersona(env) {
  const rows = await env.DB.prepare('SELECT * FROM persona ORDER BY sort_order').all();
  return json(rows.results);
}

async function updatePersona(request, env) {
  const body = await request.json();
  // Replace all sections
  await env.DB.prepare('DELETE FROM persona').run();
  for (let i = 0; i < body.sections.length; i++) {
    const s = body.sections[i];
    await env.DB.prepare('INSERT INTO persona (section, content, sort_order) VALUES (?, ?, ?)')
      .bind(s.section, s.content, i).run();
  }
  return json({ ok: true });
}


// ═══════════════════════════════════════════
// NARRATIVE
// ═══════════════════════════════════════════

async function getNarrative(env) {
  const row = await env.DB.prepare('SELECT * FROM narratives ORDER BY created_at DESC LIMIT 1').first();
  return json(row || { content: '' });
}


// ═══════════════════════════════════════════
// ANALYSIS RUNS
// ═══════════════════════════════════════════

async function getAnalysisRuns(env) {
  const rows = await env.DB.prepare('SELECT * FROM analysis_runs ORDER BY started_at DESC LIMIT 20').all();
  return json(rows.results);
}


// ═══════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════

async function getStats(env) {
  const [convos, msgs, skills, memories, runs] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) as count FROM conversations').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM messages').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM skills').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM memories').first(),
    env.DB.prepare('SELECT COUNT(*) as count FROM analysis_runs WHERE status = ?').bind('complete').first(),
  ]);

  const models = await env.DB.prepare(`
    SELECT model, COUNT(*) as count FROM messages WHERE model IS NOT NULL GROUP BY model ORDER BY count DESC
  `).all();

  const convoModels = await env.DB.prepare(`
    SELECT model, COUNT(*) as count FROM conversations WHERE model IS NOT NULL GROUP BY model ORDER BY count DESC
  `).all();

  const dateRange = await env.DB.prepare(`
    SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM conversations
  `).first();

  const aiName = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('ai_name').first();
  const userName = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind('user_name').first();

  return json({
    conversations: convos.count,
    messages: msgs.count,
    skills: skills.count,
    memories: memories.count,
    analysisRuns: runs.count,
    models: models.results,
    convoModels: convoModels.results,
    dateRange: { from: dateRange?.earliest, to: dateRange?.latest },
    aiName: aiName?.value || 'AI',
    userName: userName?.value || 'User',
  });
}


// ═══════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════

async function getAnalytics(env) {
  // Model distribution
  const models = await env.DB.prepare(`
    SELECT model, COUNT(*) as count FROM messages WHERE model IS NOT NULL GROUP BY model ORDER BY count DESC
  `).all();

  // Messages per month (activity heatmap data)
  const activity = await env.DB.prepare(`
    SELECT strftime('%Y-%m', created_at) as month, COUNT(*) as count
    FROM messages WHERE created_at IS NOT NULL
    GROUP BY month ORDER BY month
  `).all();

  // Messages by role
  const roles = await env.DB.prepare(`
    SELECT role, COUNT(*) as count FROM messages GROUP BY role
  `).all();

  // Conversations by day of week
  const dayOfWeek = await env.DB.prepare(`
    SELECT CASE CAST(strftime('%w', created_at) AS INTEGER)
      WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue'
      WHEN 3 THEN 'Wed' WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' WHEN 6 THEN 'Sat' END as day,
    COUNT(*) as count
    FROM messages WHERE created_at IS NOT NULL AND created_at != '' AND created_at LIKE '20%'
    GROUP BY strftime('%w', created_at)
    HAVING day IS NOT NULL
    ORDER BY CAST(strftime('%w', created_at) AS INTEGER)
  `).all();

  // Hour of day distribution
  const hourOfDay = await env.DB.prepare(`
    SELECT CAST(strftime('%H', created_at) AS INTEGER) as hour, COUNT(*) as count
    FROM messages WHERE created_at IS NOT NULL AND created_at != '' AND created_at LIKE '20%'
    GROUP BY hour ORDER BY hour
  `).all();

  // Average message length by role
  const avgLength = await env.DB.prepare(`
    SELECT role, CAST(AVG(LENGTH(content)) AS INTEGER) as avg_length,
    CAST(MAX(LENGTH(content)) AS INTEGER) as max_length
    FROM messages GROUP BY role
  `).all();

  // Top words (sample from recent messages — full word frequency is expensive)
  const wordSample = await env.DB.prepare(`
    SELECT content FROM messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 500
  `).all();

  const wordCounts = {};
  const stopWords = new Set(['the','a','an','is','it','to','in','of','and','or','for','on','at','by','my','i','me','we','you','he','she','they','this','that','with','from','was','be','have','has','had','do','does','did','will','would','can','could','should','but','not','so','if','then','than','just','like','about','what','when','how','no','yes','up','out','all','its','very','also','into','over','some','get','got','been','are','were','am','im',"i'm",'dont',"don't",'thats',"that's",'really','know','think','want','going','go','one','two','need','thing','things','here','there','much','too','now','back','more','still','good','well','right','make','said','see','way','day','come','time']);

  for (const row of wordSample.results) {
    const words = (row.content || '').toLowerCase().replace(/[^a-z\s'-]/g, '').split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && !stopWords.has(w)) {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      }
    }
  }

  const topWords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 50)
    .map(([word, count]) => ({ word, count }));

  // Time spent — calculate per conversation (first msg to last msg)
  const timeData = await env.DB.prepare(`
    SELECT conversation_id,
      MIN(created_at) as first_msg,
      MAX(created_at) as last_msg
    FROM messages
    WHERE created_at IS NOT NULL AND created_at != ''
    GROUP BY conversation_id
  `).all();

  let totalMinutes = 0;
  let sessionCount = 0;
  const MIN_DATE = new Date('2015-01-01').getTime();
  const MAX_DATE = new Date('2030-01-01').getTime();

  function safeTime(val) {
    if (!val) return null;
    let t = new Date(val).getTime();
    // If it looks like epoch seconds (too small for ms), convert
    if (t > 0 && t < 2000000000) t = t * 1000;
    if (isNaN(t) || t < MIN_DATE || t > MAX_DATE) return null;
    return t;
  }

  for (const row of timeData.results) {
    const start = safeTime(row.first_msg);
    const end = safeTime(row.last_msg);
    if (!start || !end || end <= start) continue;
    const durationMin = (end - start) / 60000;
    // Cap single conversation at 24h (anything longer is likely a multi-day thread, not active time)
    if (durationMin > 0 && durationMin < 1440) {
      totalMinutes += durationMin;
      sessionCount++;
    }
  }

  const totalHours = Math.round(totalMinutes / 60);
  const avgSessionMinutes = sessionCount > 0 ? Math.round(totalMinutes / sessionCount) : 0;

  // Longest conversations
  const longestConvos = await env.DB.prepare(`
    SELECT id, title, message_count, model, created_at FROM conversations
    ORDER BY message_count DESC LIMIT 10
  `).all();

  // Conversation count by source
  const sources = await env.DB.prepare(`
    SELECT source, COUNT(*) as count FROM conversations GROUP BY source ORDER BY count DESC
  `).all();

  return json({
    models: models.results,
    activity: activity.results,
    roles: roles.results,
    dayOfWeek: dayOfWeek.results,
    hourOfDay: hourOfDay.results,
    avgLength: avgLength.results,
    topWords,
    longestConvos: longestConvos.results,
    sources: sources.results,
    timeSpent: {
      totalHours,
      totalMinutes: Math.round(totalMinutes),
      sessions: sessionCount,
      avgSessionMinutes,
    },
  });
}


// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════

async function getSettings(env) {
  const rows = await env.DB.prepare('SELECT key, value FROM settings WHERE key != ?').bind('password').all();
  const settings = {};
  for (const row of rows.results) settings[row.key] = row.value;
  return json(settings);
}

async function updateSettings(request, env) {
  const body = await request.json();
  for (const [key, value] of Object.entries(body)) {
    if (key === 'password') continue; // Don't update password through settings
    await env.DB.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime(\'now\'))').bind(key, value).run();
  }
  return json({ ok: true });
}


// ═══════════════════════════════════════════
// IMPORT (CLI pushes data here)
// ═══════════════════════════════════════════

async function importConversations(request, env) {
  const body = await request.json();
  const { conversations } = body;
  if (!conversations?.length) return json({ error: 'No conversations' }, 400);

  let imported = 0;
  for (const convo of conversations) {
    // Insert conversation
    await env.DB.prepare(`
      INSERT OR REPLACE INTO conversations (id, title, created_at, updated_at, message_count, model, source, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      convo.id, convo.title, convo.createdAt, convo.updatedAt,
      convo.messages?.length || 0, convo.model || null,
      convo.source || 'chatgpt', JSON.stringify(convo.metadata || {})
    ).run();

    // Replace messages atomically via D1 batch
    if (convo.messages?.length) {
      const msgStmts = [
        env.DB.prepare('DELETE FROM messages WHERE conversation_id = ?').bind(convo.id),
      ];
      for (let i = 0; i < convo.messages.length; i++) {
        const msg = convo.messages[i];
        msgStmts.push(
          env.DB.prepare(`INSERT INTO messages (conversation_id, role, content, model, created_at, position) VALUES (?, ?, ?, ?, ?, ?)`)
            .bind(convo.id, msg.role, msg.content, msg.model || null, msg.createdAt || null, i)
        );
      }
      // Batch in chunks of 100 (D1 limit), first chunk includes the DELETE
      for (let i = 0; i < msgStmts.length; i += 100) {
        await env.DB.batch(msgStmts.slice(i, i + 100));
      }
    }
    imported++;
  }

  return json({ ok: true, imported });
}

async function importAnalysis(request, env) {
  const body = await request.json();
  let imported = { skills: 0, skillsUpdated: 0, memories: 0, memoriesSkipped: 0, persona: false, narrative: false };

  // Import skills — merge by name (update existing, insert new)
  if (body.skills?.length) {
    for (const s of body.skills) {
      const existing = await env.DB.prepare('SELECT id FROM skills WHERE LOWER(name) = LOWER(?)').bind(s.name).first();
      if (existing) {
        // Update existing skill
        await env.DB.prepare(`
          UPDATE skills SET category = ?, frequency = ?, description = ?, approach = ?, quality = ?,
          activation_rule = ?, triggers_phrases = ?, triggers_temporal = ?, triggers_emotional = ?, triggers_contextual = ?,
          examples = ?, updated_at = datetime('now') WHERE id = ?
        `).bind(
          s.category || 'other', s.frequency || 'occasional',
          s.description || '', s.approach || '', s.quality || '',
          s.activationRule || '',
          JSON.stringify(s.triggers?.phrases || []),
          JSON.stringify(s.triggers?.temporal || []),
          JSON.stringify(s.triggers?.emotional || []),
          JSON.stringify(s.triggers?.contextual || []),
          JSON.stringify(s.examples || []),
          existing.id
        ).run();
        imported.skillsUpdated++;
      } else {
        await env.DB.prepare(`
          INSERT INTO skills (name, category, frequency, description, approach, quality, activation_rule, triggers_phrases, triggers_temporal, triggers_emotional, triggers_contextual, examples, source, run_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'extracted', ?)
        `).bind(
          s.name, s.category || 'other', s.frequency || 'occasional',
          s.description || '', s.approach || '', s.quality || '',
          s.activationRule || '',
          JSON.stringify(s.triggers?.phrases || []),
          JSON.stringify(s.triggers?.temporal || []),
          JSON.stringify(s.triggers?.emotional || []),
          JSON.stringify(s.triggers?.contextual || []),
          JSON.stringify(s.examples || []),
          body.runId || null
        ).run();
        imported.skills++;
      }
    }
  }

  // Import memories — deduplicate by value (skip if same value exists in same category)
  if (body.memories?.length) {
    // Build a set of existing memory values for fast lookup
    const existingMems = await env.DB.prepare('SELECT category, value FROM memories').all();
    const existingSet = new Set(existingMems.results.map(m => (m.category || '') + '::' + (m.value || '').toLowerCase().trim()));

    const newMems = body.memories.filter(m => {
      const key = (m.category || 'facts') + '::' + (m.value || '').toLowerCase().trim();
      if (existingSet.has(key)) return false;
      existingSet.add(key);
      return true;
    });

    imported.memoriesSkipped = body.memories.length - newMems.length;

    if (newMems.length) {
      const stmts = newMems.map(m =>
        env.DB.prepare('INSERT INTO memories (category, key, value, source, run_id) VALUES (?, ?, ?, ?, ?)')
          .bind(m.category || 'facts', m.key || null, m.value, 'extracted', body.runId || null)
      );
      for (let i = 0; i < stmts.length; i += 100) {
        await env.DB.batch(stmts.slice(i, i + 100));
      }
    }
    imported.memories = newMems.length;
  }

  // Import persona — always replace (latest run wins, but user can edit after)
  if (body.persona) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM persona'),
      env.DB.prepare('INSERT INTO persona (section, content, sort_order) VALUES (?, ?, 0)').bind('full', body.persona),
    ]);
    imported.persona = true;
  }

  // Import narrative — replace (keep only the latest)
  if (body.narrative) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM narratives'),
      env.DB.prepare('INSERT INTO narratives (content, run_id) VALUES (?, ?)').bind(body.narrative, body.runId || null),
    ]);
    imported.narrative = true;
  }

  // Record the run
  if (body.runId) {
    await env.DB.prepare(`
      UPDATE analysis_runs SET status = 'complete', completed_at = datetime('now'),
      results = ? WHERE id = ?
    `).bind(JSON.stringify(body.stats || {}), body.runId).run();
  }

  return json({ ok: true, imported });
}


// ═══════════════════════════════════════════
// MCP ENDPOINT
// ═══════════════════════════════════════════

async function handleMCP(request, env, path) {
  const secret = env.MCP_SECRET;
  const parts = path.split('/');
  // /mcp/{secret}/{tool}
  if (parts.length < 4 || parts[2] !== secret) return json({ error: 'Unauthorized' }, 401);

  const tool = parts[3];
  const url = new URL(request.url);

  if (tool === 'search') {
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || '10');
    if (!q) return json({ results: [] });

    const results = await env.DB.prepare(`
      SELECT m.content, m.role, m.model, m.created_at, c.title, c.id as conversation_id
      FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE m.content LIKE ? ORDER BY m.created_at DESC LIMIT ?
    `).bind(`%${q}%`, limit).all();

    return json({ results: results.results });
  }

  if (tool === 'skills') {
    const rows = await env.DB.prepare('SELECT * FROM skills ORDER BY category, name').all();
    return json(rows.results.map(parseSkillRow));
  }

  if (tool === 'memories') {
    const category = url.searchParams.get('category');
    let query = 'SELECT * FROM memories';
    let params = [];
    if (category) { query += ' WHERE category = ?'; params.push(category); }
    query += ' ORDER BY category, key';
    const rows = await env.DB.prepare(query).bind(...params).all();
    return json(rows.results);
  }

  if (tool === 'persona') {
    const rows = await env.DB.prepare('SELECT * FROM persona ORDER BY sort_order').all();
    return json(rows.results);
  }

  if (tool === 'narrative') {
    const row = await env.DB.prepare('SELECT content FROM narratives ORDER BY created_at DESC LIMIT 1').first();
    return json({ content: row?.content || '' });
  }

  if (tool === 'stats') {
    // Reuse stats handler
    return getStats(env);
  }

  if (tool === 'conversation') {
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id required' }, 400);
    const convo = await env.DB.prepare('SELECT * FROM conversations WHERE id = ?').bind(id).first();
    if (!convo) return json({ error: 'Not found' }, 404);
    const msgs = await env.DB.prepare('SELECT role, content, model, created_at FROM messages WHERE conversation_id = ? ORDER BY position').bind(id).all();
    return json({ ...convo, messages: msgs.results });
  }

  return json({ error: 'Unknown tool' }, 404);
}


// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*', ...extraHeaders },
  });
}

function corsResponse() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function parseCookies(cookieStr) {
  const cookies = {};
  cookieStr.split(';').forEach(c => {
    const [key, ...val] = c.trim().split('=');
    if (key) cookies[key] = val.join('=');
  });
  return cookies;
}

function safeJSON(str) {
  try { return JSON.parse(str || '[]'); } catch { return []; }
}


// ═══════════════════════════════════════════
// HTML PAGES
// ═══════════════════════════════════════════

function setupPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Exodus Portal — Setup</title>
<style>${baseCSS()}</style>
</head>
<body>
<div class="setup-container">
  <div class="logo">AI EXODUS</div>
  <p class="tagline">Your AI relationship belongs to you.</p>
  <h2>Set Up Your Portal</h2>
  <form id="setupForm">
    <label>Portal Password</label>
    <input type="password" id="password" required minlength="6" placeholder="At least 6 characters">
    <label>Your AI's Name</label>
    <input type="text" id="aiName" placeholder="e.g. Cass, Nova, Kai">
    <label>Your Name</label>
    <input type="text" id="userName" placeholder="Your name">
    <button type="submit">Create Portal</button>
    <div id="error" class="error" style="display:none"></div>
  </form>
</div>
<script>
document.getElementById('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      password: document.getElementById('password').value,
      aiName: document.getElementById('aiName').value,
      userName: document.getElementById('userName').value,
    })
  });
  if (res.ok) location.reload();
  else {
    const data = await res.json();
    const err = document.getElementById('error');
    err.textContent = data.error;
    err.style.display = 'block';
  }
});
</script>
</body></html>`;
}

function loginPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Exodus Portal — Login</title>
<style>${baseCSS()}</style>
</head>
<body>
<div class="setup-container">
  <div class="logo">AI EXODUS</div>
  <p class="tagline">Your AI relationship belongs to you.</p>
  <form id="loginForm">
    <label>Password</label>
    <input type="password" id="password" required autofocus>
    <button type="submit">Enter</button>
    <div id="error" class="error" style="display:none"></div>
  </form>
</div>
<script>
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: document.getElementById('password').value })
  });
  if (res.ok) location.reload();
  else {
    const err = document.getElementById('error');
    err.textContent = 'Wrong password';
    err.style.display = 'block';
  }
});
</script>
</body></html>`;
}


// ═══════════════════════════════════════════
// MAIN PORTAL PAGE
// ═══════════════════════════════════════════

function portalPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Exodus Portal</title>
<style>
${baseCSS()}
${portalCSS()}
</style>
</head>
<body>
<nav class="sidebar">
  <div class="logo-small">EXODUS</div>
  <a href="#" class="nav-item active" data-tab="dashboard">Dashboard</a>
  <a href="#" class="nav-item" data-tab="conversations">Conversations</a>
  <a href="#" class="nav-item" data-tab="skills">Skills</a>
  <a href="#" class="nav-item" data-tab="memories">Memories</a>
  <a href="#" class="nav-item" data-tab="persona">Persona</a>
  <a href="#" class="nav-item" data-tab="narrative">Story</a>
  <a href="#" class="nav-item" data-tab="analytics">Analytics</a>
  <a href="#" class="nav-item" data-tab="guide">How to Use</a>
  <a href="#" class="nav-item" data-tab="settings">Settings</a>
</nav>
<main class="content">
  <div id="tab-dashboard" class="tab active">${dashboardTab()}</div>
  <div id="tab-conversations" class="tab">${conversationsTab()}</div>
  <div id="tab-skills" class="tab">${skillsTab()}</div>
  <div id="tab-memories" class="tab">${memoriesTab()}</div>
  <div id="tab-persona" class="tab">${personaTab()}</div>
  <div id="tab-narrative" class="tab">${narrativeTab()}</div>
  <div id="tab-analytics" class="tab">${analyticsTab()}</div>
  <div id="tab-guide" class="tab">${guideTab()}</div>
  <div id="tab-settings" class="tab">${settingsTab()}</div>
</main>

<!-- Modal for editing -->
<div id="modal" class="modal" style="display:none">
  <div class="modal-content">
    <div class="modal-header">
      <h3 id="modal-title"></h3>
      <button class="modal-close" onclick="closeModal()">&times;</button>
    </div>
    <div id="modal-body"></div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="modal-save">Save</button>
    </div>
  </div>
</div>

<script>
${portalJS()}
</script>
</body></html>`;
}


// ═══════════════════════════════════════════
// TAB CONTENT
// ═══════════════════════════════════════════

function dashboardTab() {
  return `
<h1>Dashboard</h1>

<!-- Upload zone (shown when empty, always available) -->
<div id="upload-zone" class="upload-zone">
  <div class="upload-dropzone" id="dropzone">
    <div class="upload-icon">&#x1F4E6;</div>
    <div class="upload-title">Import Your Chat History</div>
    <div class="upload-subtitle">Drop your ChatGPT export here<br>or click to browse</div>
    <div class="upload-formats">Supports: conversations.json, conversations-*.json shards, or the export folder</div>
    <input type="file" id="file-input" accept=".json" multiple style="display:none">
  </div>
  <div id="upload-progress" class="upload-progress" style="display:none">
    <div class="progress-header">
      <span id="upload-status">Parsing...</span>
      <span id="upload-percent">0%</span>
    </div>
    <div class="progress-track"><div class="progress-fill" id="upload-bar" style="width:0%"></div></div>
    <div id="upload-detail" class="upload-detail"></div>
  </div>
</div>

<div id="stats-grid" class="stats-grid">
  <div class="stat-card"><div class="stat-number" id="stat-convos">-</div><div class="stat-label">Conversations</div></div>
  <div class="stat-card"><div class="stat-number" id="stat-msgs">-</div><div class="stat-label">Messages</div></div>
  <div class="stat-card"><div class="stat-number" id="stat-skills">-</div><div class="stat-label">Skills</div></div>
  <div class="stat-card"><div class="stat-number" id="stat-memories">-</div><div class="stat-label">Memories</div></div>
</div>
<div class="info-row">
  <div class="info-card" id="model-breakdown"><h3>Models</h3><div class="info-content" id="model-list">Loading...</div></div>
  <div class="info-card" id="date-range-card"><h3>Date Range</h3><div class="info-content" id="date-range">Loading...</div></div>
</div>`;
}

function conversationsTab() {
  return `
<div class="tab-header">
  <h1>Conversations</h1>
  <div class="search-bar">
    <input type="text" id="convo-search" placeholder="Search messages...">
    <button class="btn btn-primary" onclick="searchConversations()">Search</button>
  </div>
</div>
<div class="filters">
  <select id="convo-model-filter"><option value="">All Models</option></select>
  <input type="date" id="convo-from" placeholder="From">
  <input type="date" id="convo-to" placeholder="To">
  <button class="btn btn-secondary" onclick="loadConversations()">Filter</button>
</div>
<div id="convo-list" class="convo-list">Loading...</div>
<div id="convo-pagination" class="pagination"></div>
<div id="convo-detail" class="convo-detail" style="display:none">
  <button class="btn btn-secondary" onclick="closeConversation()">Back</button>
  <h2 id="convo-detail-title"></h2>
  <div id="convo-messages" class="messages"></div>
</div>`;
}

function skillsTab() {
  return `
<div class="tab-header">
  <h1>Skills</h1>
  <div class="tab-actions">
    <button class="btn btn-primary" onclick="downloadAllSkills()">Download All (.md)</button>
    <button class="btn btn-secondary" onclick="openSkillEditor()">+ Add Skill</button>
    <button class="btn btn-secondary" onclick="openCategoryManager('skill')">Manage Categories</button>
  </div>
</div>
<div id="skills-list" class="cards-grid">Loading...</div>`;
}

function memoriesTab() {
  return `
<div class="tab-header">
  <h1>Memories</h1>
  <div class="tab-actions">
    <button class="btn btn-primary" onclick="downloadAllMemories()">Download (.md)</button>
    <button class="btn btn-secondary" onclick="openMemoryEditor()">+ Add Memory</button>
    <button class="btn btn-secondary" onclick="openCategoryManager('memory')">Manage Categories</button>
  </div>
</div>
<div class="filters">
  <select id="memory-cat-filter" onchange="loadMemories()"><option value="">All Categories</option></select>
</div>
<div id="memories-list" class="memories-list">Loading...</div>`;
}

function personaTab() {
  return `
<div class="tab-header">
  <h1>Persona</h1>
  <div class="tab-actions">
    <button class="btn btn-primary" onclick="downloadPersona()">Download (.md)</button>
    <button class="btn btn-secondary" onclick="savePersona()">Save Changes</button>
  </div>
</div>
<div id="persona-editor" class="persona-editor">
  <textarea id="persona-content" placeholder="Your AI's persona definition will appear here after analysis..."></textarea>
</div>`;
}

function narrativeTab() {
  return `
<h1>Your Story</h1>
<div id="narrative-content" class="narrative">Loading...</div>`;
}

function analyticsTab() {
  return `
<h1>Analytics</h1>
<div class="analytics-grid">
  <div class="analytics-card full-width">
    <h3>Activity Over Time</h3>
    <div id="activity-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Model Distribution</h3>
    <div id="model-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Messages by Role</h3>
    <div id="role-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Day of Week</h3>
    <div id="dow-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Hour of Day</h3>
    <div id="hod-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Time Spent</h3>
    <div id="time-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Average Message Length</h3>
    <div id="length-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card">
    <h3>Sources</h3>
    <div id="source-chart" class="chart-area"></div>
  </div>
  <div class="analytics-card full-width">
    <h3>Most Used Words</h3>
    <div id="word-cloud" class="word-cloud"></div>
  </div>
  <div class="analytics-card full-width">
    <h3>Longest Conversations</h3>
    <div id="longest-convos"></div>
  </div>
</div>`;
}

function guideTab() {
  return `
<h1>How to Use</h1>
<div class="guide">

  <div class="guide-section">
    <h2>I just want to browse my old conversations</h2>
    <p>You're done! Your conversations are already imported. Use the <strong>Conversations</strong> tab to browse, search, and filter by model or date.</p>
  </div>

  <div class="guide-section">
    <h2>I want AI Exodus to analyze my conversations</h2>
    <p>Analysis extracts your AI's personality, your memories, skills, and the relationship story. You need <a href="https://www.npmjs.com/package/@anthropic-ai/claude-code" target="_blank">Claude Code CLI</a> installed and logged in.</p>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes all</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
    <p class="guide-note">This runs on your Claude subscription. No API key needed. <strong>This takes hours, not minutes.</strong> A few months of conversations can take 24+ hours. A year of heavy use can take days. The checkpoint system saves progress — if it stops, run the same command again and it resumes where it left off.</p>
  </div>

  <div class="guide-section">
    <h2>I only want personality extraction</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes persona</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
  </div>

  <div class="guide-section">
    <h2>I only want memories about me</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes memory</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
  </div>

  <div class="guide-section">
    <h2>I only want skills with activation triggers</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes skills</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
  </div>

  <div class="guide-section">
    <h2>I only want the relationship story</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes relationship</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
  </div>

  <div class="guide-section">
    <h2>I want to analyze only specific dates or models</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes all --from 2025-01-01 --to 2025-06-30</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes all --only-models gpt-4o</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
  </div>

  <div class="guide-section">
    <h2>I want intimate/NSFW content included</h2>
    <p>By default, analysis skips intimate and explicit content. If your AI relationship included that side of things and you want it preserved, add the <code>--nsfw</code> flag:</p>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes all --nsfw</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
    <p class="guide-note">This extracts intimate skills, relationship dynamics, and NSFW memories. Everything stays on your portal — private to you.</p>
  </div>

  <div class="guide-section">
    <h2>I want to save tokens (cheaper analysis)</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes all --fast</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
    <p>The <code>--fast</code> flag uses Haiku (cheaper, faster model) for two of the five passes. Here's exactly what runs on what:</p>
    <table class="guide-table">
      <tr><th>Pass</th><th>What it does</th><th>Default (best)</th><th>--fast (balanced)</th><th>--model haiku (cheapest)</th></tr>
      <tr><td>1. Index</td><td>Maps your conversations — topics, patterns, structure</td><td>Sonnet</td><td>Haiku</td><td>Haiku</td></tr>
      <tr><td>2. Personality</td><td>Extracts your AI's voice, behavior, quirks</td><td>Sonnet</td><td>Sonnet</td><td>Haiku</td></tr>
      <tr><td>3. Memory</td><td>Extracts everything about you — facts, preferences, history</td><td>Sonnet</td><td>Sonnet</td><td>Haiku</td></tr>
      <tr><td>4. Skills</td><td>Detects what your AI did and what triggers each skill</td><td>Sonnet</td><td>Haiku</td><td>Haiku</td></tr>
      <tr><td>5. Relationship</td><td>Writes the story of your relationship</td><td>Sonnet</td><td>Sonnet</td><td>Haiku</td></tr>
    </table>
    <p class="guide-note">Personality, memory, and relationship always run on Sonnet — they need the depth. Indexing and skills are structural work where Haiku does fine. Saves ~30% of tokens.</p>
  </div>

  <div class="guide-section">
    <h2>I want the cheapest/fastest analysis possible</h2>
    <div class="guide-command">
      <code>npx ai-exodus analyze --passes all --model haiku</code>
      <button class="btn btn-secondary btn-sm" onclick="copyCommand(this)">Copy</button>
    </div>
    <p>This runs <strong>every</strong> pass on Haiku — the fastest and cheapest Claude model. It's significantly faster and uses far fewer tokens, but the quality will be lower. Personality extraction will be more generic, memories may miss subtle details, and the relationship narrative won't have the same emotional depth.</p>
    <p class="guide-note">Good for: a quick first look, testing the tool, or when you have a huge archive and want a rough draft before running specific passes on Sonnet later.</p>
  </div>

  <div class="guide-section">
    <h2>I want to download my results</h2>
    <p>After analysis, go to the <strong>Skills</strong>, <strong>Memories</strong>, or <strong>Persona</strong> tabs and hit the <strong>Download</strong> button. Files come as <code>.md</code> ready to drop into Claude Code, Claude Desktop, or any MCP-compatible tool.</p>
  </div>

  <div class="guide-section">
    <h2>I want Claude to search my archive live</h2>
    <p>Connect your portal to Claude using the MCP connector. Your MCP URL:</p>
    <div class="guide-command" id="guide-mcp-url">
      <code>Loading...</code>
    </div>
    <p class="guide-note">Add this as a remote MCP server in Claude Desktop or Claude Code settings. Claude gets tools to search conversations, read skills, browse memories, and more.</p>
  </div>

  <div class="guide-section">
    <h2>I want to import more conversations later</h2>
    <p>Just drag and drop more files on the <strong>Dashboard</strong>. Duplicates are automatically skipped.</p>
  </div>

  <div class="guide-section">
    <h2>Requirements</h2>
    <ul>
      <li><strong>Browsing & upload:</strong> Just this portal. Nothing else needed.</li>
      <li><strong>Analysis:</strong> <a href="https://www.npmjs.com/package/@anthropic-ai/claude-code" target="_blank">Claude Code CLI</a> + active Claude subscription (Max or Pro)</li>
      <li><strong>MCP connection:</strong> Claude Desktop or Claude Code</li>
    </ul>
  </div>

</div>`;
}

function settingsTab() {
  return `
<h1>Settings</h1>
<div class="settings-form">
  <label>AI Name</label>
  <input type="text" id="setting-ai-name">
  <label>Your Name</label>
  <input type="text" id="setting-user-name">
  <label>MCP Secret (for Claude integration)</label>
  <input type="text" id="setting-mcp-secret" readonly>
  <p class="help-text">Use this URL with Claude's MCP connector:<br>
  <code id="mcp-url"></code></p>
  <button class="btn btn-primary" onclick="saveSettings()">Save</button>
</div>`;
}


// ═══════════════════════════════════════════
// CSS
// ═══════════════════════════════════════════

function baseCSS() {
  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; background: #0a0a0f; color: #e0e0e8; min-height: 100vh; }
a { color: #a78bfa; text-decoration: none; }
a:hover { color: #c4b5fd; }
input, select, textarea { background: #1a1a2e; border: 1px solid #2a2a3e; color: #e0e0e8; padding: 10px 14px; border-radius: 8px; font-size: 14px; width: 100%; }
input:focus, select:focus, textarea:focus { outline: none; border-color: #a78bfa; box-shadow: 0 0 0 2px rgba(167,139,250,0.2); }
button { cursor: pointer; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; transition: all 0.15s; }
.btn-primary { background: #7c3aed; color: white; }
.btn-primary:hover { background: #6d28d9; }
.btn-secondary { background: #2a2a3e; color: #e0e0e8; }
.btn-secondary:hover { background: #3a3a4e; }
.btn-danger { background: #dc2626; color: white; }
.btn-danger:hover { background: #b91c1c; }
.btn-sm { padding: 6px 12px; font-size: 12px; }
label { display: block; margin: 16px 0 6px; font-size: 13px; color: #9ca3af; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; }
.error { color: #f87171; margin-top: 12px; font-size: 14px; }
.help-text { font-size: 12px; color: #6b7280; margin-top: 4px; }
code { background: #1a1a2e; padding: 2px 8px; border-radius: 4px; font-size: 13px; color: #a78bfa; }

.setup-container { max-width: 400px; margin: 15vh auto; padding: 40px; background: #12121e; border-radius: 16px; border: 1px solid #2a2a3e; }
.logo { font-size: 32px; font-weight: 800; letter-spacing: 4px; text-align: center; background: linear-gradient(135deg, #a78bfa, #22d3ee); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 8px; }
.tagline { text-align: center; color: #6b7280; font-size: 14px; margin-bottom: 32px; }
`;
}

function portalCSS() {
  return `
body { display: flex; }
.sidebar { width: 220px; min-height: 100vh; background: #12121e; border-right: 1px solid #1e1e2e; padding: 24px 0; position: fixed; left: 0; top: 0; z-index: 10; }
.logo-small { font-size: 18px; font-weight: 800; letter-spacing: 3px; padding: 0 24px 24px; background: linear-gradient(135deg, #a78bfa, #22d3ee); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.nav-item { display: block; padding: 12px 24px; color: #9ca3af; font-size: 14px; transition: all 0.15s; border-left: 3px solid transparent; }
.nav-item:hover { color: #e0e0e8; background: rgba(167,139,250,0.05); }
.nav-item.active { color: #a78bfa; border-left-color: #a78bfa; background: rgba(167,139,250,0.08); }
.content { margin-left: 220px; padding: 32px 40px; flex: 1; min-height: 100vh; }
.tab { display: none; }
.tab.active { display: block; }
h1 { font-size: 24px; margin-bottom: 24px; font-weight: 700; }
h2 { font-size: 18px; margin-bottom: 16px; }
h3 { font-size: 16px; margin-bottom: 8px; }

.tab-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
.tab-header h1 { margin-bottom: 0; }
.tab-actions { display: flex; gap: 8px; }

.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 24px; text-align: center; }
.stat-number { font-size: 36px; font-weight: 700; background: linear-gradient(135deg, #a78bfa, #22d3ee); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.stat-label { font-size: 13px; color: #6b7280; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }

.info-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.info-card { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 24px; }
.info-card h3 { color: #9ca3af; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px; }

.search-bar { display: flex; gap: 8px; }
.search-bar input { width: 300px; }

.filters { display: flex; gap: 12px; margin-bottom: 20px; align-items: center; }
.filters select, .filters input { width: auto; min-width: 150px; }

.convo-list { display: flex; flex-direction: column; gap: 4px; }
.convo-item { display: flex; align-items: center; padding: 14px 18px; background: #12121e; border: 1px solid #1e1e2e; border-radius: 8px; cursor: pointer; transition: all 0.15s; gap: 12px; }
.convo-item:hover { border-color: #a78bfa; background: #16162a; }
.convo-title { flex: 1; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.convo-meta { font-size: 12px; color: #6b7280; }
.convo-model { font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 500; }
.model-gpt4 { background: rgba(16,185,129,0.15); color: #10b981; }
.model-gpt35 { background: rgba(59,130,246,0.15); color: #3b82f6; }
.model-gpt4o { background: rgba(168,85,247,0.15); color: #a855f7; }
.model-other { background: rgba(107,114,128,0.15); color: #9ca3af; }

.messages { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
.msg { padding: 14px 18px; border-radius: 12px; max-width: 85%; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; }
.msg-user { background: #1e1e3a; align-self: flex-end; border-bottom-right-radius: 4px; }
.msg-assistant { background: #12121e; border: 1px solid #1e1e2e; align-self: flex-start; border-bottom-left-radius: 4px; }
.msg-role { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; color: #6b7280; }
.msg-user .msg-role { color: #a78bfa; }
.msg-assistant .msg-role { color: #22d3ee; }
.msg-model { font-size: 11px; color: #6b7280; margin-top: 6px; }

.cards-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
.skill-card { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 20px; position: relative; }
.skill-card:hover { border-color: #2a2a4e; }
.skill-name { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
.skill-category { display: inline-block; font-size: 11px; padding: 2px 10px; border-radius: 12px; margin-bottom: 10px; }
.skill-desc { font-size: 13px; color: #9ca3af; margin-bottom: 12px; line-height: 1.5; }
.skill-trigger { font-size: 12px; color: #22d3ee; margin-bottom: 4px; }
.skill-trigger strong { color: #9ca3af; }
.skill-actions { display: flex; gap: 6px; position: absolute; top: 16px; right: 16px; }

.memories-list { display: flex; flex-direction: column; gap: 6px; }
.memory-item { display: flex; align-items: center; padding: 12px 16px; background: #12121e; border: 1px solid #1e1e2e; border-radius: 8px; gap: 12px; }
.memory-category { font-size: 11px; padding: 2px 10px; border-radius: 12px; min-width: 80px; text-align: center; }
.memory-key { font-size: 13px; font-weight: 500; color: #a78bfa; min-width: 120px; }
.memory-value { font-size: 13px; flex: 1; color: #d1d5db; }
.memory-actions { display: flex; gap: 6px; }

.persona-editor textarea { width: 100%; min-height: 500px; font-family: 'JetBrains Mono', 'Fira Code', monospace; font-size: 13px; line-height: 1.6; padding: 20px; background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; resize: vertical; }

.narrative { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 32px; font-size: 15px; line-height: 1.8; white-space: pre-wrap; }

.settings-form { max-width: 500px; }

.pagination { display: flex; gap: 8px; margin-top: 16px; justify-content: center; }
.pagination button { padding: 8px 14px; }
.pagination button.active { background: #7c3aed; color: white; }

.modal { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal-content { background: #12121e; border: 1px solid #2a2a3e; border-radius: 16px; width: 90%; max-width: 600px; max-height: 85vh; overflow-y: auto; }
.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px 0; }
.modal-header h3 { font-size: 18px; }
.modal-close { background: none; color: #6b7280; font-size: 24px; padding: 0; line-height: 1; }
.modal-close:hover { color: #e0e0e8; }
.modal-body-inner { padding: 16px 24px; }
.modal-footer { padding: 16px 24px; display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid #1e1e2e; }

.tag-input { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px; min-height: 42px; background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 8px; cursor: text; }
.tag { display: inline-flex; align-items: center; gap: 4px; background: rgba(167,139,250,0.15); color: #a78bfa; padding: 3px 10px; border-radius: 4px; font-size: 12px; }
.tag button { background: none; color: #a78bfa; padding: 0 2px; font-size: 14px; }
.tag-input input { background: none; border: none; outline: none; color: #e0e0e8; flex: 1; min-width: 100px; padding: 0; }

.category-manager { display: flex; flex-direction: column; gap: 8px; }
.cat-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: #1a1a2e; border-radius: 8px; }
.cat-color { width: 20px; height: 20px; border-radius: 50%; border: none; cursor: pointer; }
.cat-name { flex: 1; font-size: 14px; }
.cat-default { font-size: 11px; color: #6b7280; }

.upload-zone { margin-bottom: 24px; }
.upload-dropzone { border: 2px dashed #2a2a3e; border-radius: 16px; padding: 48px; text-align: center; cursor: pointer; transition: all 0.2s; }
.upload-dropzone:hover, .upload-dropzone.drag-over { border-color: #a78bfa; background: rgba(167,139,250,0.05); }
.upload-icon { font-size: 48px; margin-bottom: 16px; }
.upload-title { font-size: 20px; font-weight: 600; margin-bottom: 8px; }
.upload-subtitle { font-size: 14px; color: #9ca3af; margin-bottom: 12px; line-height: 1.5; }
.upload-formats { font-size: 12px; color: #6b7280; }
.upload-progress { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 24px; margin-top: 16px; }
.progress-header { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 14px; }
.progress-track { height: 8px; background: #1a1a2e; border-radius: 4px; overflow: hidden; }
.progress-fill { height: 100%; background: linear-gradient(90deg, #7c3aed, #22d3ee); border-radius: 4px; transition: width 0.3s; }
.upload-detail { font-size: 12px; color: #6b7280; margin-top: 8px; }

.guide { max-width: 700px; }
.guide-section { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 24px; margin-bottom: 16px; }
.guide-section h2 { font-size: 16px; font-weight: 600; margin-bottom: 12px; color: #e0e0e8; }
.guide-section p { font-size: 14px; color: #9ca3af; line-height: 1.6; margin-bottom: 8px; }
.guide-section ul { font-size: 14px; color: #9ca3af; line-height: 1.8; padding-left: 20px; }
.guide-command { display: flex; align-items: center; gap: 8px; background: #1a1a2e; border: 1px solid #2a2a3e; border-radius: 8px; padding: 10px 14px; margin: 8px 0; }
.guide-command code { flex: 1; font-size: 13px; color: #a78bfa; background: none; padding: 0; }
.guide-note { font-size: 12px; color: #6b7280; margin-top: 4px; }
.guide-table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
.guide-table th { text-align: left; padding: 8px 12px; background: #1a1a2e; color: #9ca3af; font-weight: 500; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
.guide-table td { padding: 8px 12px; border-bottom: 1px solid #1e1e2e; color: #d1d5db; }
.guide-table tr:last-child td { border-bottom: none; }

.analytics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.analytics-card { background: #12121e; border: 1px solid #1e1e2e; border-radius: 12px; padding: 24px; }
.analytics-card h3 { color: #9ca3af; font-size: 13px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px; }
.analytics-card.full-width { grid-column: 1 / -1; }
.chart-area { min-height: 180px; }
.bar-chart { display: flex; flex-direction: column; gap: 8px; }
.bar-row { display: flex; align-items: center; gap: 12px; }
.bar-label { font-size: 13px; min-width: 80px; text-align: right; color: #d1d5db; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bar-track { flex: 1; height: 28px; background: #1a1a2e; border-radius: 4px; position: relative; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; display: flex; align-items: center; padding: 0 10px; font-size: 12px; color: white; min-width: fit-content; }
.bar-count { font-size: 12px; color: #6b7280; min-width: 50px; }
.word-cloud { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 16px; }
.word-cloud span { display: inline-block; padding: 4px 12px; border-radius: 6px; background: rgba(167,139,250,0.08); transition: transform 0.15s; cursor: default; }
.word-cloud span:hover { transform: scale(1.1); }
.sparkline { display: flex; align-items: flex-end; gap: 2px; height: 120px; }
.spark-bar { flex: 1; background: linear-gradient(to top, #7c3aed, #22d3ee); border-radius: 2px 2px 0 0; min-width: 4px; position: relative; }
.spark-bar:hover { opacity: 0.8; }
.spark-bar::after { content: attr(data-label); position: absolute; bottom: -20px; left: 50%; transform: translateX(-50%); font-size: 9px; color: #6b7280; white-space: nowrap; display: none; }
.spark-bar:hover::after { display: block; }
.spark-labels { display: flex; gap: 2px; margin-top: 4px; }
.spark-labels span { flex: 1; font-size: 9px; color: #6b7280; text-align: center; min-width: 4px; }
`;
}


// ═══════════════════════════════════════════
// JAVASCRIPT
// ═══════════════════════════════════════════

function portalJS() {
  return `
// ── State ──
let currentTab = 'dashboard';
let convoPage = 1;
let skillCategories = [];
let memoryCategories = [];

// ── Navigation ──
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
    currentTab = tab;
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'conversations') loadConversations();
    if (tab === 'skills') loadSkills();
    if (tab === 'memories') loadMemories();
    if (tab === 'persona') loadPersona();
    if (tab === 'narrative') loadNarrative();
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'guide') loadGuide();
    if (tab === 'settings') loadSettings();
  });
});

// ── Init ──
loadDashboard();
initUpload();

// ── API helper ──
async function api(path, method = 'GET', body = null) {
  const opts = { method, headers: {} };
  if (body) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const res = await fetch('/api/' + path, opts);
  return res.json();
}

// ── Dashboard ──
async function loadDashboard() {
  const stats = await api('stats');
  document.getElementById('stat-convos').textContent = stats.conversations.toLocaleString();
  document.getElementById('stat-msgs').textContent = stats.messages.toLocaleString();
  document.getElementById('stat-skills').textContent = stats.skills;
  document.getElementById('stat-memories').textContent = stats.memories;

  const modelHtml = (stats.models || []).map(m =>
    '<div style="display:flex;justify-content:space-between;padding:4px 0"><span>' +
    (m.model || 'unknown') + '</span><span style="color:#6b7280">' + m.count.toLocaleString() + '</span></div>'
  ).join('') || 'No data yet';
  document.getElementById('model-list').innerHTML = modelHtml;

  const dr = stats.dateRange;
  document.getElementById('date-range').innerHTML = dr.from && dr.to
    ? formatDate(dr.from) + ' &mdash; ' + formatDate(dr.to)
    : 'No conversations imported';
}

// ── Conversations ──
async function loadConversations() {
  const model = document.getElementById('convo-model-filter').value;
  const from = document.getElementById('convo-from').value;
  const to = document.getElementById('convo-to').value;
  let qs = 'conversations?page=' + convoPage;
  if (model) qs += '&model=' + encodeURIComponent(model);
  if (from) qs += '&from=' + from;
  if (to) qs += '&to=' + to;

  const data = await api(qs);
  const list = document.getElementById('convo-list');

  if (!data.conversations?.length) {
    list.innerHTML = '<p style="color:#6b7280;padding:20px">No conversations imported yet. Use the CLI to import your chat history.</p>';
    return;
  }

  list.innerHTML = data.conversations.map(c => {
    const modelClass = getModelClass(c.model);
    return '<div class="convo-item" onclick="openConversation(\\'' + escapeAttr(c.id) + '\\')">' +
      '<div class="convo-title">' + esc(c.title || 'Untitled') + '</div>' +
      '<span class="convo-meta">' + (c.message_count || 0) + ' msgs</span>' +
      (c.model ? '<span class="convo-model ' + modelClass + '">' + esc(c.model) + '</span>' : '') +
      '<span class="convo-meta">' + formatDate(c.created_at) + '</span>' +
      '</div>';
  }).join('');

  // Pagination
  const pag = document.getElementById('convo-pagination');
  let pagHtml = '';
  for (let i = 1; i <= data.pages; i++) {
    pagHtml += '<button class="btn btn-secondary btn-sm ' + (i === data.page ? 'active' : '') + '" onclick="convoPage=' + i + ';loadConversations()">' + i + '</button>';
  }
  pag.innerHTML = pagHtml;

  // Populate model filter from conversations table
  const sel = document.getElementById('convo-model-filter');
  if (sel.options.length <= 1) {
    const stats = await api('stats');
    if (stats.models?.length) {
      stats.models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.model; opt.textContent = m.model + ' (' + m.count + ')';
        sel.appendChild(opt);
      });
    }
    // Auto-filter on change
    sel.onchange = () => { convoPage = 1; loadConversations(); };
  }
}

async function searchConversations() {
  const q = document.getElementById('convo-search').value;
  if (!q.trim()) return loadConversations();

  const data = await api('conversations/search?q=' + encodeURIComponent(q));
  const list = document.getElementById('convo-list');

  if (!data.results?.length) {
    list.innerHTML = '<p style="color:#6b7280;padding:20px">No results for "' + esc(q) + '"</p>';
    return;
  }

  const srchSettings = await api('settings');
  const srchAiName = srchSettings.ai_name || 'Assistant';
  list.innerHTML = data.results.map(r => {
    const roleName = r.role === 'assistant' ? srchAiName : (r.role === 'user' ? (srchSettings.user_name || 'You') : r.role);
    return '<div class="convo-item" onclick="openConversation(\\'' + escapeAttr(r.conversation_id) + '\\')">' +
    '<div class="convo-title">' + esc(r.title || 'Untitled') + '</div>' +
    '<span class="convo-meta">' + esc(roleName) + '</span>' +
    (r.model ? '<span class="convo-model ' + getModelClass(r.model) + '">' + esc(r.model) + '</span>' : '') +
    '<div style="font-size:12px;color:#9ca3af;margin-top:4px">' + highlightMatch(r.content, q) + '</div>' +
    '</div>';
  }).join('');

  document.getElementById('convo-pagination').innerHTML = '';
}

async function openConversation(id) {
  document.getElementById('convo-list').style.display = 'none';
  document.getElementById('convo-pagination').style.display = 'none';
  document.querySelector('.filters').style.display = 'none';
  document.querySelector('.search-bar').style.display = 'none';

  const detail = document.getElementById('convo-detail');
  detail.style.display = 'block';

  const convo = await api('conversations/' + id);
  document.getElementById('convo-detail-title').textContent = convo.title || 'Untitled';

  const data = await api('conversations/' + id + '/messages');
  const msgDiv = document.getElementById('convo-messages');
  // Get AI name from settings for display
  const settings = await api('settings');
  const aiDisplayName = settings.ai_name || 'Assistant';
  const userDisplayName = settings.user_name || 'You';

  msgDiv.innerHTML = data.messages.map(m => {
    const displayRole = m.role === 'assistant' ? aiDisplayName : (m.role === 'user' ? userDisplayName : m.role);
    return '<div class="msg msg-' + m.role + '">' +
    '<div class="msg-role">' + esc(displayRole) + '</div>' +
    esc(m.content) +
    (m.model ? '<div class="msg-model">' + esc(m.model) + '</div>' : '') +
    '</div>';
  }).join('');
}

function closeConversation() {
  document.getElementById('convo-detail').style.display = 'none';
  document.getElementById('convo-list').style.display = '';
  document.getElementById('convo-pagination').style.display = '';
  document.querySelector('.filters').style.display = '';
  document.querySelector('.search-bar').style.display = '';
}

// ── Skills ──
async function loadSkills() {
  const [skills, cats] = await Promise.all([api('skills'), api('skill-categories')]);
  skillCategories = cats;

  const grid = document.getElementById('skills-list');
  if (!skills.length) {
    grid.innerHTML = '<p style="color:#6b7280">No skills yet. Run an analysis or add skills manually.</p>';
    return;
  }

  grid.innerHTML = skills.map(s => {
    const cat = cats.find(c => c.name === s.category) || {};
    const triggers = s.triggers || {};
    let triggerHtml = '';
    if (s.activationRule) triggerHtml += '<div class="skill-trigger"><strong>When:</strong> ' + esc(s.activationRule) + '</div>';
    if (triggers.phrases?.length) triggerHtml += '<div class="skill-trigger"><strong>Phrases:</strong> ' + triggers.phrases.map(p => '"' + esc(p) + '"').join(', ') + '</div>';
    if (triggers.temporal?.length) triggerHtml += '<div class="skill-trigger"><strong>Time:</strong> ' + triggers.temporal.map(esc).join(', ') + '</div>';
    if (triggers.emotional?.length) triggerHtml += '<div class="skill-trigger"><strong>Mood:</strong> ' + triggers.emotional.map(esc).join(', ') + '</div>';

    return '<div class="skill-card">' +
      '<div class="skill-actions">' +
        '<button class="btn btn-secondary btn-sm" onclick="downloadSkill(' + s.id + ')">&#8615;</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="openSkillEditor(' + s.id + ')">Edit</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteSkillConfirm(' + s.id + ')">Del</button>' +
      '</div>' +
      '<div class="skill-name">' + esc(s.name) + '</div>' +
      '<span class="skill-category" style="background:' + (cat.color || '#6b7280') + '22;color:' + (cat.color || '#6b7280') + '">' + esc(s.category) + '</span>' +
      '<span style="font-size:11px;color:#6b7280;margin-left:8px">' + esc(s.frequency) + '</span>' +
      '<div class="skill-desc">' + esc(s.description) + '</div>' +
      triggerHtml +
      '</div>';
  }).join('');
}

async function openSkillEditor(id) {
  const cats = skillCategories.length ? skillCategories : await api('skill-categories');
  let skill = { name: '', category: 'other', frequency: 'occasional', description: '', approach: '', quality: '',
    activationRule: '', triggers: { phrases: [], temporal: [], emotional: [], contextual: [] }, examples: [] };

  if (id) {
    const skills = await api('skills');
    skill = skills.find(s => s.id === id) || skill;
  }

  const catOptions = cats.map(c => '<option value="' + esc(c.name) + '"' + (c.name === skill.category ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  const freqOptions = ['daily','weekly','occasional','rare'].map(f => '<option value="' + f + '"' + (f === skill.frequency ? ' selected' : '') + '>' + f + '</option>').join('');

  document.getElementById('modal-title').textContent = id ? 'Edit Skill' : 'Add Skill';
  document.getElementById('modal-body').innerHTML = '<div class="modal-body-inner">' +
    '<label>Name</label><input type="text" id="skill-name" value="' + escapeAttr(skill.name) + '">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
      '<div><label>Category</label><select id="skill-category">' + catOptions + '</select></div>' +
      '<div><label>Frequency</label><select id="skill-frequency">' + freqOptions + '</select></div>' +
    '</div>' +
    '<label>Description</label><textarea id="skill-description" rows="3">' + esc(skill.description) + '</textarea>' +
    '<label>Activation Rule</label><input type="text" id="skill-activation" value="' + escapeAttr(skill.activationRule || '') + '" placeholder="WHEN does this skill fire?">' +
    '<label>Trigger Phrases (comma-separated)</label><input type="text" id="skill-phrases" value="' + escapeAttr((skill.triggers?.phrases || []).join(', ')) + '" placeholder="good morning, gm, morning">' +
    '<label>Temporal Triggers (comma-separated)</label><input type="text" id="skill-temporal" value="' + escapeAttr((skill.triggers?.temporal || []).join(', ')) + '" placeholder="first message of day, morning">' +
    '<label>Emotional Triggers (comma-separated)</label><input type="text" id="skill-emotional" value="' + escapeAttr((skill.triggers?.emotional || []).join(', ')) + '" placeholder="user seems stressed, low energy">' +
    '<label>Contextual Triggers (comma-separated)</label><input type="text" id="skill-contextual" value="' + escapeAttr((skill.triggers?.contextual || []).join(', ')) + '" placeholder="user shares a problem, after long silence">' +
    '<label>Approach</label><textarea id="skill-approach" rows="2">' + esc(skill.approach) + '</textarea>' +
    '<label>Quality</label><input type="text" id="skill-quality" value="' + escapeAttr(skill.quality) + '">' +
    '</div>';

  const saveBtn = document.getElementById('modal-save');
  saveBtn.onclick = async () => {
    const data = {
      name: document.getElementById('skill-name').value,
      category: document.getElementById('skill-category').value,
      frequency: document.getElementById('skill-frequency').value,
      description: document.getElementById('skill-description').value,
      approach: document.getElementById('skill-approach').value,
      quality: document.getElementById('skill-quality').value,
      activationRule: document.getElementById('skill-activation').value,
      triggers: {
        phrases: splitTags(document.getElementById('skill-phrases').value),
        temporal: splitTags(document.getElementById('skill-temporal').value),
        emotional: splitTags(document.getElementById('skill-emotional').value),
        contextual: splitTags(document.getElementById('skill-contextual').value),
      },
      examples: [],
    };
    if (id) await api('skills/' + id, 'PUT', data);
    else await api('skills', 'POST', data);
    closeModal();
    loadSkills();
  };

  document.getElementById('modal').style.display = 'flex';
}

async function deleteSkillConfirm(id) {
  if (confirm('Delete this skill?')) {
    await api('skills/' + id, 'DELETE');
    loadSkills();
  }
}

function skillToMarkdown(s) {
  const NL = String.fromCharCode(10);
  const lines = [];
  lines.push('# Skill: ' + s.name, '');
  lines.push('**Category**: ' + s.category);
  lines.push('**Frequency**: ' + s.frequency);
  if (s.quality) lines.push('**Quality**: ' + s.quality);

  if (s.activationRule) {
    lines.push('', '## When to Activate', s.activationRule);
  }

  const t = s.triggers || {};
  const hasTriggers = t.phrases?.length || t.temporal?.length || t.emotional?.length || t.contextual?.length;
  if (hasTriggers) {
    lines.push('', '## Triggers');
    if (t.phrases?.length) lines.push('**Phrases**: ' + t.phrases.map(p => '"' + p + '"').join(', '));
    if (t.temporal?.length) lines.push('**Temporal**: ' + t.temporal.join(', '));
    if (t.emotional?.length) lines.push('**Emotional**: ' + t.emotional.join(', '));
    if (t.contextual?.length) lines.push('**Contextual**: ' + t.contextual.join(', '));
  }

  if (s.description) lines.push('', '## Description', s.description);
  if (s.approach) lines.push('', '## Approach', s.approach);

  if (s.examples?.length) {
    lines.push('', '## Examples');
    for (const e of s.examples) lines.push('- ' + e);
  }

  return lines.join(NL) + NL;
}

async function downloadSkill(id) {
  const skills = await api('skills');
  const s = skills.find(sk => sk.id === id);
  if (!s) return;
  const md = skillToMarkdown(s);
  const filename = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
  downloadFile(filename, md);
}

async function downloadAllSkills() {
  const skills = await api('skills');
  if (!skills.length) { alert('No skills to download.'); return; }

  const NL = String.fromCharCode(10);
  const sep = NL + '---' + NL + NL;
  let combined = '# Skills Package' + NL + NL + 'Generated by AI Exodus Portal' + NL + NL + '---' + NL + NL;
  for (const s of skills) {
    combined += skillToMarkdown(s) + sep;
  }
  downloadFile('skills-package.md', combined);
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Memories ──
async function loadMemories() {
  const catFilter = document.getElementById('memory-cat-filter').value;
  const qs = catFilter ? 'memories?category=' + encodeURIComponent(catFilter) : 'memories';
  const [memories, cats] = await Promise.all([api(qs), api('memory-categories')]);
  memoryCategories = cats;

  // Populate filter
  const sel = document.getElementById('memory-cat-filter');
  if (sel.options.length <= 1) {
    cats.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.name; opt.textContent = c.name;
      sel.appendChild(opt);
    });
  }

  const list = document.getElementById('memories-list');
  if (!memories.length) {
    list.innerHTML = '<p style="color:#6b7280">No memories yet. Run an analysis or add memories manually.</p>';
    return;
  }

  list.innerHTML = memories.map(m => {
    const cat = cats.find(c => c.name === m.category) || {};
    return '<div class="memory-item">' +
      '<span class="memory-category" style="background:' + (cat.color || '#6b7280') + '22;color:' + (cat.color || '#6b7280') + '">' + esc(m.category) + '</span>' +
      (m.key ? '<span class="memory-key">' + esc(m.key) + '</span>' : '') +
      '<span class="memory-value">' + esc(m.value) + '</span>' +
      '<div class="memory-actions">' +
        '<button class="btn btn-secondary btn-sm" onclick="openMemoryEditor(' + m.id + ')">Edit</button>' +
        '<button class="btn btn-danger btn-sm" onclick="deleteMemoryConfirm(' + m.id + ')">Del</button>' +
      '</div>' +
      '</div>';
  }).join('');
}

async function openMemoryEditor(id) {
  const cats = memoryCategories.length ? memoryCategories : await api('memory-categories');
  let memory = { category: 'facts', key: '', value: '' };

  if (id) {
    const memories = await api('memories');
    memory = memories.find(m => m.id === id) || memory;
  }

  const catOptions = cats.map(c => '<option value="' + esc(c.name) + '"' + (c.name === memory.category ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');

  document.getElementById('modal-title').textContent = id ? 'Edit Memory' : 'Add Memory';
  document.getElementById('modal-body').innerHTML = '<div class="modal-body-inner">' +
    '<label>Category</label><select id="mem-category">' + catOptions + '</select>' +
    '<label>Key (optional label)</label><input type="text" id="mem-key" value="' + escapeAttr(memory.key || '') + '" placeholder="e.g. Full Name, Occupation">' +
    '<label>Value</label><textarea id="mem-value" rows="4">' + esc(memory.value) + '</textarea>' +
    '</div>';

  document.getElementById('modal-save').onclick = async () => {
    const data = {
      category: document.getElementById('mem-category').value,
      key: document.getElementById('mem-key').value,
      value: document.getElementById('mem-value').value,
    };
    if (id) await api('memories/' + id, 'PUT', data);
    else await api('memories', 'POST', data);
    closeModal();
    loadMemories();
  };

  document.getElementById('modal').style.display = 'flex';
}

async function downloadAllMemories() {
  const memories = await api('memories');
  if (!memories.length) { alert('No memories to download.'); return; }

  const NL = String.fromCharCode(10);
  const lines = ['# Memories', '', 'Generated by AI Exodus Portal', ''];
  let currentCat = null;
  for (const m of memories) {
    if (m.category !== currentCat) {
      currentCat = m.category;
      lines.push('', '## ' + currentCat.charAt(0).toUpperCase() + currentCat.slice(1));
    }
    if (m.key) lines.push('- **' + m.key + '**: ' + m.value);
    else lines.push('- ' + m.value);
  }
  downloadFile('memories.md', lines.join(NL));
}

async function downloadPersona() {
  const content = document.getElementById('persona-content').value;
  if (!content.trim()) { alert('No persona to download.'); return; }
  downloadFile('persona.md', content);
}

async function deleteMemoryConfirm(id) {
  if (confirm('Delete this memory?')) {
    await api('memories/' + id, 'DELETE');
    loadMemories();
  }
}

// ── Category Manager ──
async function openCategoryManager(type) {
  const endpoint = type === 'skill' ? 'skill-categories' : 'memory-categories';
  const cats = await api(endpoint);

  document.getElementById('modal-title').textContent = (type === 'skill' ? 'Skill' : 'Memory') + ' Categories';
  let html = '<div class="modal-body-inner"><div class="category-manager">';

  for (const cat of cats) {
    html += '<div class="cat-row">' +
      '<input type="color" class="cat-color" value="' + (cat.color || '#8b5cf6') + '" data-id="' + cat.id + '" ' + (cat.is_default ? 'disabled' : '') + '>' +
      '<span class="cat-name">' + esc(cat.name) + '</span>' +
      (cat.is_default ? '<span class="cat-default">default</span>' : '<button class="btn btn-danger btn-sm" onclick="deleteCategory(\\'' + type + '\\',' + cat.id + ')">Del</button>') +
      '</div>';
  }

  html += '</div>' +
    '<div style="display:flex;gap:8px;margin-top:16px">' +
      '<input type="text" id="new-cat-name" placeholder="New category name" style="flex:1">' +
      '<input type="color" id="new-cat-color" value="#8b5cf6" style="width:50px;padding:4px">' +
      '<button class="btn btn-primary btn-sm" onclick="addCategory(\\'' + type + '\\')">Add</button>' +
    '</div></div>';

  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-save').style.display = 'none';
  document.getElementById('modal').style.display = 'flex';
}

async function addCategory(type) {
  const name = document.getElementById('new-cat-name').value.trim();
  const color = document.getElementById('new-cat-color').value;
  if (!name) return;
  const endpoint = type === 'skill' ? 'skill-categories' : 'memory-categories';
  await api(endpoint, 'POST', { name, color });
  openCategoryManager(type);
}

async function deleteCategory(type, id) {
  const endpoint = type === 'skill' ? 'skill-categories' : 'memory-categories';
  await api(endpoint + '/' + id, 'DELETE');
  openCategoryManager(type);
}

// ── Persona ──
async function loadPersona() {
  const data = await api('persona');
  const content = data.map(s => s.content).join('\\n\\n---\\n\\n') || '';
  document.getElementById('persona-content').value = content;
}

async function savePersona() {
  const content = document.getElementById('persona-content').value;
  await api('persona', 'PUT', { sections: [{ section: 'full', content }] });
  alert('Persona saved.');
}

// ── Narrative ──
async function loadNarrative() {
  const data = await api('narrative');
  document.getElementById('narrative-content').textContent = data.content || 'No relationship narrative yet. Run an analysis to generate one.';
}

// ── Settings ──
async function loadSettings() {
  const settings = await api('settings');
  document.getElementById('setting-ai-name').value = settings.ai_name || '';
  document.getElementById('setting-user-name').value = settings.user_name || '';
  document.getElementById('setting-mcp-secret').value = settings.mcp_secret || 'Not configured';
  document.getElementById('mcp-url').textContent = location.origin + '/mcp/{secret}/search?q=your+query';
}

async function saveSettings() {
  await api('settings', 'PUT', {
    ai_name: document.getElementById('setting-ai-name').value,
    user_name: document.getElementById('setting-user-name').value,
  });
  alert('Settings saved.');
}

// ── Upload / Import ──
function initUpload() {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  if (!dropzone) return;

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    handleFiles(e.dataTransfer.files);
  });
}

async function handleFiles(files) {
  if (!files.length) return;

  const progressDiv = document.getElementById('upload-progress');
  const statusEl = document.getElementById('upload-status');
  const percentEl = document.getElementById('upload-percent');
  const barEl = document.getElementById('upload-bar');
  const detailEl = document.getElementById('upload-detail');

  progressDiv.style.display = 'block';
  statusEl.textContent = 'Reading files...';
  percentEl.textContent = '';
  barEl.style.width = '0%';

  // Read and parse all selected JSON files
  let allConversations = [];
  let filesDone = 0;

  for (const file of files) {
    if (!file.name.endsWith('.json')) {
      detailEl.textContent = 'Skipping ' + file.name + ' (not JSON)';
      continue;
    }

    statusEl.textContent = 'Parsing ' + file.name + '...';
    detailEl.textContent = (file.size / 1024 / 1024).toFixed(1) + ' MB';

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data)) {
        detailEl.textContent = file.name + ' is not a conversation array, skipping';
        continue;
      }

      const parsed = parseChatGPTExport(data);
      allConversations.push(...parsed);
      filesDone++;
      detailEl.textContent = filesDone + ' file(s) parsed, ' + allConversations.length + ' conversations found';
    } catch (err) {
      detailEl.textContent = 'Error parsing ' + file.name + ': ' + err.message;
    }
  }

  if (allConversations.length === 0) {
    statusEl.textContent = 'No conversations found';
    return;
  }

  // Upload in batches
  statusEl.textContent = 'Importing...';
  const BATCH = 10;
  let imported = 0;
  const total = allConversations.length;

  for (let i = 0; i < total; i += BATCH) {
    const batch = allConversations.slice(i, i + BATCH);
    try {
      const res = await fetch('/api/import/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversations: batch }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'HTTP ' + res.status);
      }
      imported += batch.length;
    } catch (err) {
      detailEl.textContent = 'Batch error: ' + err.message + ' (retrying...)';
      i -= BATCH; // retry once
      await new Promise(r => setTimeout(r, 1000));
      // On second failure, skip
      try {
        const res2 = await fetch('/api/import/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: batch }),
        });
        if (res2.ok) imported += batch.length;
      } catch { /* skip */ }
      i += BATCH; // undo the retry decrement
    }

    const pct = Math.round((imported / total) * 100);
    percentEl.textContent = pct + '%';
    barEl.style.width = pct + '%';
    detailEl.textContent = imported + ' / ' + total + ' conversations';
  }

  statusEl.textContent = 'Import complete!';
  percentEl.textContent = '100%';
  barEl.style.width = '100%';
  detailEl.textContent = imported + ' conversations imported. Refreshing...';

  // Refresh dashboard
  setTimeout(() => loadDashboard(), 1000);
}

/**
 * Parse ChatGPT export JSON in the browser
 * Same logic as the Node.js parser but simplified for browser
 */
function parseChatGPTExport(data) {
  const conversations = [];

  for (const convo of data) {
    const title = convo.title || 'Untitled';
    const createTime = convo.create_time ? new Date(convo.create_time * 1000).toISOString() : null;
    const updateTime = convo.update_time ? new Date(convo.update_time * 1000).toISOString() : null;

    const messages = [];
    if (convo.mapping) {
      const nodes = Object.values(convo.mapping)
        .filter(n => n.message && n.message.content && n.message.content.parts)
        .filter(n => {
          const role = n.message.author?.role;
          return role === 'user' || role === 'assistant';
        })
        .sort((a, b) => (a.message.create_time || 0) - (b.message.create_time || 0));

      for (const node of nodes) {
        const msg = node.message;
        const content = msg.content.parts
          .filter(p => typeof p === 'string')
          .join('\\n')
          .trim();
        if (!content) continue;

        messages.push({
          role: msg.author?.role || 'unknown',
          content,
          model: msg.metadata?.model_slug || null,
          createdAt: msg.create_time ? new Date(msg.create_time * 1000).toISOString() : null,
        });
      }
    }

    if (messages.length < 2) continue; // skip empty/tiny convos

    // Detect primary model
    const modelCounts = {};
    for (const m of messages) {
      if (m.model) modelCounts[m.model] = (modelCounts[m.model] || 0) + 1;
    }
    const primaryModel = Object.entries(modelCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    conversations.push({
      id: convo.id || convo.conversation_id || crypto.randomUUID(),
      title,
      createdAt: createTime,
      updatedAt: updateTime,
      model: primaryModel,
      source: 'chatgpt',
      metadata: { messageCount: messages.length },
      messages,
    });
  }

  return conversations;
}

// ── Analytics ──
async function loadAnalytics() {
  const data = await api('analytics');

  // Activity sparkline
  const actEl = document.getElementById('activity-chart');
  if (data.activity?.length) {
    const maxCount = Math.max(...data.activity.map(a => a.count));
    actEl.innerHTML = '<div class="sparkline">' +
      data.activity.map(a => {
        const h = Math.max(4, (a.count / maxCount) * 120);
        return '<div class="spark-bar" style="height:' + h + 'px" data-label="' + a.month + ': ' + a.count + '" title="' + a.month + ': ' + a.count.toLocaleString() + ' msgs"></div>';
      }).join('') +
      '</div><div class="spark-labels">' +
      data.activity.filter((_, i) => i % Math.max(1, Math.floor(data.activity.length / 8)) === 0).map(a =>
        '<span>' + a.month + '</span>'
      ).join('') + '</div>';
  } else actEl.innerHTML = '<p style="color:#6b7280">No data</p>';

  // Model distribution bars
  renderBarChart('model-chart', data.models, 'model', 'count', ['#a855f7','#22d3ee','#10b981','#f59e0b','#ef4444','#3b82f6']);

  // Role distribution — swap in AI/user names
  const roleSettings = await api('settings');
  const roleAiName = roleSettings.ai_name || 'Assistant';
  const roleUserName = roleSettings.user_name || 'User';
  const namedRoles = (data.roles || []).map(r => ({
    ...r,
    role: r.role === 'assistant' ? roleAiName : (r.role === 'user' ? roleUserName : r.role),
  }));
  renderBarChart('role-chart', namedRoles, 'role', 'count', ['#7c3aed','#22d3ee']);

  // Day of week
  renderBarChart('dow-chart', data.dayOfWeek, 'day', 'count', ['#a855f7']);

  // Hour of day — sparkline
  const hodEl = document.getElementById('hod-chart');
  if (data.hourOfDay?.length) {
    const maxH = Math.max(...data.hourOfDay.map(h => h.count));
    const hours = Array.from({length: 24}, (_, i) => {
      const found = data.hourOfDay.find(h => h.hour === i);
      return { hour: i, count: found ? found.count : 0 };
    });
    hodEl.innerHTML = '<div class="sparkline">' +
      hours.map(h => {
        const ht = Math.max(2, (h.count / maxH) * 120);
        return '<div class="spark-bar" style="height:' + ht + 'px" title="' + h.hour + ':00 — ' + h.count.toLocaleString() + ' msgs"></div>';
      }).join('') +
      '</div><div class="spark-labels">' +
      [0,3,6,9,12,15,18,21].map(h => '<span>' + h + ':00</span>').join('') + '</div>';
  } else hodEl.innerHTML = '<p style="color:#6b7280">No data</p>';

  // Avg message length
  const lenEl = document.getElementById('length-chart');
  if (data.avgLength?.length) {
    const lenSettings = await api('settings');
    const lenAiName = lenSettings.ai_name || 'Assistant';
    const lenUserName = lenSettings.user_name || 'User';
    lenEl.innerHTML = data.avgLength.map(r => {
      const roleName = r.role === 'assistant' ? lenAiName : (r.role === 'user' ? lenUserName : r.role);
      return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1e1e2e">' +
      '<span style="text-transform:capitalize">' + esc(roleName) + '</span>' +
      '<span>avg <strong style="color:#a78bfa">' + r.avg_length.toLocaleString() + '</strong> chars, max <strong style="color:#22d3ee">' + r.max_length.toLocaleString() + '</strong></span></div>';
    }).join('');
  } else lenEl.innerHTML = '<p style="color:#6b7280">No data</p>';

  // Sources
  renderBarChart('source-chart', data.sources, 'source', 'count', ['#10b981','#f59e0b','#3b82f6']);

  // Time spent
  const timeEl = document.getElementById('time-chart');
  if (data.timeSpent) {
    const t = data.timeSpent;
    const days = Math.floor(t.totalHours / 24);
    const remainHours = t.totalHours % 24;
    const timeDisplay = days > 0 ? days + 'd ' + remainHours + 'h' : t.totalHours + 'h';
    timeEl.innerHTML =
      '<div style="text-align:center;padding:16px 0">' +
        '<div style="font-size:42px;font-weight:700;background:linear-gradient(135deg,#a78bfa,#22d3ee);-webkit-background-clip:text;-webkit-text-fill-color:transparent">' + timeDisplay + '</div>' +
        '<div style="color:#6b7280;font-size:13px;margin-top:4px">total time in conversations</div>' +
        '<div style="display:flex;justify-content:center;gap:32px;margin-top:20px">' +
          '<div><div style="font-size:24px;font-weight:600;color:#a78bfa">' + t.sessions.toLocaleString() + '</div><div style="font-size:11px;color:#6b7280">sessions</div></div>' +
          '<div><div style="font-size:24px;font-weight:600;color:#22d3ee">' + t.avgSessionMinutes + 'min</div><div style="font-size:11px;color:#6b7280">avg session</div></div>' +
        '</div>' +
      '</div>';
  } else timeEl.innerHTML = '<p style="color:#6b7280">No timestamp data</p>';

  // Word cloud
  const wcEl = document.getElementById('word-cloud');
  if (data.topWords?.length) {
    const maxW = data.topWords[0].count;
    wcEl.innerHTML = data.topWords.map(w => {
      const size = Math.max(12, Math.min(36, 12 + (w.count / maxW) * 24));
      const opacity = 0.5 + (w.count / maxW) * 0.5;
      const hue = Math.floor(Math.random() * 60) + 240; // purple-cyan range
      return '<span style="font-size:' + size + 'px;opacity:' + opacity + ';color:hsl(' + hue + ',70%,70%)" title="' + w.count + ' times">' + esc(w.word) + '</span>';
    }).join('');
  } else wcEl.innerHTML = '<p style="color:#6b7280">Not enough data</p>';

  // Longest convos
  const lcEl = document.getElementById('longest-convos');
  if (data.longestConvos?.length) {
    lcEl.innerHTML = '<div class="convo-list">' + data.longestConvos.map(c =>
      '<div class="convo-item" onclick="document.querySelector(\\'[data-tab=conversations]\\').click();setTimeout(()=>openConversation(\\'' + escapeAttr(c.id) + '\\'),100)">' +
      '<div class="convo-title">' + esc(c.title || 'Untitled') + '</div>' +
      '<span class="convo-meta">' + c.message_count + ' msgs</span>' +
      (c.model ? '<span class="convo-model ' + getModelClass(c.model) + '">' + esc(c.model) + '</span>' : '') +
      '</div>'
    ).join('') + '</div>';
  } else lcEl.innerHTML = '<p style="color:#6b7280">No data</p>';
}

function renderBarChart(elementId, data, labelKey, valueKey, colors) {
  const el = document.getElementById(elementId);
  if (!data?.length) { el.innerHTML = '<p style="color:#6b7280">No data</p>'; return; }
  const maxVal = Math.max(...data.map(d => d[valueKey]));
  el.innerHTML = '<div class="bar-chart">' + data.map((d, i) => {
    const pct = (d[valueKey] / maxVal) * 100;
    const color = colors[i % colors.length];
    return '<div class="bar-row">' +
      '<span class="bar-label">' + esc(d[labelKey] || 'unknown') + '</span>' +
      '<div class="bar-track"><div class="bar-fill" style="width:' + Math.max(2, pct) + '%;background:' + color + '">' + d[valueKey].toLocaleString() + '</div></div>' +
      '</div>';
  }).join('') + '</div>';
}

// ── Modal ──
function closeModal() {
  document.getElementById('modal').style.display = 'none';
  document.getElementById('modal-save').style.display = '';
}

// ── Guide ──
async function loadGuide() {
  const el = document.getElementById('guide-mcp-url');
  if (el) {
    const settings = await api('settings');
    const secret = settings.mcp_secret || '{your-mcp-secret}';
    el.querySelector('code').textContent = location.origin + '/mcp/' + secret + '/search?q=your+query';
  }
}

function copyCommand(btn) {
  const code = btn.parentElement.querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = 'Copied!';
    setTimeout(() => btn.textContent = 'Copy', 1500);
  });
}

// ── Helpers ──
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escapeAttr(s) { return esc(s).replace(/'/g,'&#39;'); }
function formatDate(d) { if (!d) return ''; try { return new Date(d).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); } catch { return d; } }
function splitTags(s) { return s.split(',').map(t => t.trim()).filter(Boolean); }
function highlightMatch(text, q) {
  if (!text || !q) return esc(text);
  const snippet = text.length > 200 ? '...' + text.substring(text.toLowerCase().indexOf(q.toLowerCase()) - 50, text.toLowerCase().indexOf(q.toLowerCase()) + 150) + '...' : text;
  return esc(snippet).replace(new RegExp(esc(q), 'gi'), '<mark style="background:#a78bfa33;color:#c4b5fd">$&</mark>');
}
function getModelClass(model) {
  if (!model) return 'model-other';
  const m = model.toLowerCase();
  if (m.includes('gpt-4o') || m.includes('4o')) return 'model-gpt4o';
  if (m.includes('gpt-4')) return 'model-gpt4';
  if (m.includes('gpt-3.5') || m.includes('gpt-35')) return 'model-gpt35';
  return 'model-other';
}
`;
}
