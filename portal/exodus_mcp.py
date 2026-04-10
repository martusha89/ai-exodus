"""
AI Exodus Portal — MCP Server
Connects Claude to your personal chat archive via the portal's API.

Tools:
  exodus_search        — Search conversation history by keyword
  exodus_conversation  — Get a full conversation by ID
  exodus_skills        — List all extracted skills with triggers
  exodus_memories      — List memories, optionally filtered by category
  exodus_persona       — Get the AI persona definition
  exodus_stats         — Get archive statistics
  exodus_narrative     — Get the relationship narrative

Usage:
  python exodus_mcp.py

Configure in Claude Desktop / Claude Code MCP settings.
"""

import os
import json
import urllib.request
import urllib.parse
import urllib.error
from mcp.server.fastmcp import FastMCP

# ── Config ──
PORTAL_URL = os.environ.get("EXODUS_PORTAL_URL", "")
MCP_SECRET = os.environ.get("EXODUS_MCP_SECRET", "")
PORTAL_PASSWORD = os.environ.get("EXODUS_PORTAL_PASSWORD", "")

# Try loading from ~/.exodus/config.json if env vars not set
if not PORTAL_URL or not MCP_SECRET:
    config_path = os.path.join(
        os.environ.get("USERPROFILE", os.environ.get("HOME", "")),
        ".exodus", "config.json"
    )
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            config = json.load(f)
        if not PORTAL_URL:
            PORTAL_URL = config.get("portalUrl", "")
        if not MCP_SECRET:
            MCP_SECRET = config.get("mcpSecret", "")
        if not PORTAL_PASSWORD:
            PORTAL_PASSWORD = config.get("portalPassword", "")

mcp = FastMCP("AI Exodus Archive")


def _mcp_url(tool, params=None):
    """Build MCP endpoint URL."""
    base = f"{PORTAL_URL}/mcp/{MCP_SECRET}/{tool}"
    if params:
        qs = urllib.parse.urlencode({k: v for k, v in params.items() if v})
        base += "?" + qs
    return base


def _fetch(tool, params=None):
    """Fetch from portal MCP endpoint."""
    url = _mcp_url(tool, params)
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return {"error": f"HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def exodus_search(query: str, limit: int = 10) -> str:
    """Search your conversation history. Returns matching messages with conversation context.
    Use this to find specific conversations, topics, or things that were discussed."""
    if not query.strip():
        return "Please provide a search query."

    data = _fetch("search", {"q": query, "limit": str(limit)})

    if "error" in data:
        return f"Search error: {data['error']}"

    results = data.get("results", [])
    if not results:
        return f'No results found for "{query}".'

    lines = [f'Found {len(results)} results for "{query}":\n']
    for r in results:
        title = r.get("title", "Untitled")
        role = r.get("role", "?")
        model = r.get("model", "")
        content = r.get("content", "")
        # Truncate long content
        if len(content) > 300:
            # Try to show the part around the query
            idx = content.lower().find(query.lower())
            if idx > 0:
                start = max(0, idx - 100)
                content = "..." + content[start:start + 300] + "..."
            else:
                content = content[:300] + "..."

        lines.append(f"**{title}** ({role}, {model or 'unknown model'})")
        lines.append(f"  {content}")
        lines.append(f"  [Conversation ID: {r.get('conversation_id', '?')}]")
        lines.append("")

    return "\n".join(lines)


@mcp.tool()
def exodus_conversation(conversation_id: str) -> str:
    """Get the full content of a specific conversation by its ID.
    Use after searching to read the complete conversation."""
    data = _fetch("conversation", {"id": conversation_id})

    if "error" in data:
        return f"Error: {data['error']}"

    title = data.get("title", "Untitled")
    messages = data.get("messages", [])

    if not messages:
        return f"Conversation '{title}' has no messages."

    lines = [f"# {title}\n"]
    for msg in messages:
        role = msg.get("role", "?").upper()
        content = msg.get("content", "")
        model = msg.get("model", "")
        model_tag = f" [{model}]" if model else ""
        lines.append(f"**{role}**{model_tag}: {content}\n")

    return "\n".join(lines)


@mcp.tool()
def exodus_skills() -> str:
    """List all extracted skills with their activation triggers.
    Shows what the AI could do and when each skill activates."""
    data = _fetch("skills")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['error']}"

    if not data:
        return "No skills found. Run an analysis first."

    lines = [f"Found {len(data)} skills:\n"]
    for s in data:
        name = s.get("name", "?")
        category = s.get("category", "?")
        freq = s.get("frequency", "?")
        rule = s.get("activation_rule", "")
        desc = s.get("description", "")

        lines.append(f"### {name}")
        lines.append(f"Category: {category} | Frequency: {freq}")
        if rule:
            lines.append(f"Activates: {rule}")
        if desc:
            lines.append(f"Description: {desc}")

        # Triggers
        phrases = _safe_json(s.get("triggers_phrases"))
        temporal = _safe_json(s.get("triggers_temporal"))
        emotional = _safe_json(s.get("triggers_emotional"))
        if phrases:
            lines.append(f"Phrases: {', '.join(phrases)}")
        if temporal:
            lines.append(f"Temporal: {', '.join(temporal)}")
        if emotional:
            lines.append(f"Emotional: {', '.join(emotional)}")
        lines.append("")

    return "\n".join(lines)


@mcp.tool()
def exodus_memories(category: str = "") -> str:
    """List memories about the user. Optionally filter by category.
    Categories: identity, life, preferences, personality, relationship, timeline, emotional, facts"""
    params = {}
    if category:
        params["category"] = category

    data = _fetch("memories", params)

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['error']}"

    if not data:
        cat_text = f" in category '{category}'" if category else ""
        return f"No memories found{cat_text}. Run an analysis first."

    lines = [f"Found {len(data)} memories:\n"]
    current_cat = None
    for m in data:
        cat = m.get("category", "?")
        if cat != current_cat:
            current_cat = cat
            lines.append(f"\n## {cat.title()}")

        key = m.get("key", "")
        value = m.get("value", "")
        if key:
            lines.append(f"- **{key}**: {value}")
        else:
            lines.append(f"- {value}")

    return "\n".join(lines)


@mcp.tool()
def exodus_persona() -> str:
    """Get the AI persona definition — the personality profile extracted from conversations."""
    data = _fetch("persona")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['error']}"

    if not data:
        return "No persona found. Run an analysis first."

    return "\n\n".join(s.get("content", "") for s in data)


@mcp.tool()
def exodus_stats() -> str:
    """Get archive statistics — conversation count, message count, model breakdown, date range."""
    data = _fetch("stats")

    if "error" in data:
        return f"Error: {data['error']}"

    lines = [
        "# Archive Statistics\n",
        f"- **Conversations**: {data.get('conversations', 0):,}",
        f"- **Messages**: {data.get('messages', 0):,}",
        f"- **Skills**: {data.get('skills', 0)}",
        f"- **Memories**: {data.get('memories', 0)}",
        f"- **Analysis runs**: {data.get('analysisRuns', 0)}",
        f"- **AI Name**: {data.get('aiName', '?')}",
        f"- **User Name**: {data.get('userName', '?')}",
    ]

    dr = data.get("dateRange", {})
    if dr.get("from"):
        lines.append(f"- **Date range**: {dr['from']} to {dr.get('to', '?')}")

    models = data.get("models", [])
    if models:
        lines.append("\n## Model Breakdown")
        for m in models:
            lines.append(f"- {m.get('model', '?')}: {m.get('count', 0):,} messages")

    return "\n".join(lines)


@mcp.tool()
def exodus_narrative() -> str:
    """Get the relationship narrative — the story of the human-AI relationship."""
    data = _fetch("narrative")

    if isinstance(data, dict) and "error" in data:
        return f"Error: {data['error']}"

    content = data.get("content", "")
    if not content:
        return "No narrative found. Run a full analysis first."

    return content


def _safe_json(val):
    """Parse a JSON string or return the value if already parsed."""
    if not val:
        return []
    if isinstance(val, list):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return []


if __name__ == "__main__":
    if not PORTAL_URL:
        print("Error: No portal URL configured.")
        print("Set EXODUS_PORTAL_URL environment variable or run 'ai-exodus deploy' first.")
        print("Config is read from ~/.exodus/config.json")
        exit(1)
    if not MCP_SECRET:
        print("Error: No MCP secret configured.")
        print("Set EXODUS_MCP_SECRET environment variable or check ~/.exodus/config.json")
        exit(1)

    mcp.run(transport="stdio")
