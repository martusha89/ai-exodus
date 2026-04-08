# AI Exodus

**Move your AI relationship from any platform to Claude. One command. Everything transfers.**

Your AI relationship belongs to you. Not OpenAI. Not Character.AI. Not any platform. When you need to move — because they changed, not because you did — you should be able to take everything with you.

AI Exodus reads your chat export, runs a 5-pass analysis through Claude, and generates a complete migration package: personality, memories, skills, preferences, and the story of your relationship.

## Quick Start

```bash
npx ai-exodus migrate conversations.json
```

That's it. Go make a coffee — your AI is being reconstructed.

## Requirements

- **Node.js 18+**
- **Claude Code CLI** installed and logged in (runs on your subscription, no API key needed)

Install Claude Code:
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

## Usage

```bash
# Basic migration from ChatGPT export
ai-exodus migrate conversations.json

# With AI name and date range
ai-exodus migrate export.json --name "Aria" --user "Sam" --from 2025-01-01 --to 2025-12-31

# Only GPT-4o conversations, include NSFW content
ai-exodus migrate export.json --only-models gpt-4o --nsfw

# Fast mode (Haiku for indexing/skills, saves ~30% tokens)
ai-exodus migrate export.json --fast

# Include Hearthline or Letta output packages
ai-exodus migrate export.json --hearthline --letta

# See all supported formats
ai-exodus formats
```

## Getting Your Export

### ChatGPT
1. Go to [chat.openai.com](https://chat.openai.com)
2. Settings > Data Controls > Export Data
3. Wait for the email, download the ZIP
4. Extract it — you need `conversations.json`

### Raw Text Logs
Any copy-pasted conversation transcript works. Save it as a `.txt` file. The tool auto-detects speaker patterns.

### Coming Soon
- Character.AI exports
- Replika GDPR exports
- SillyTavern / TavernAI character cards

## What You Get

```
exodus-output/
├── custom-instructions.txt  — Paste into Claude.ai settings (short, dense)
├── persona.md               — Full personality definition
├── claude.md                — Drop-in CLAUDE.md for Claude Code
├── memory/
│   ├── about-user.md        — Everything about you
│   ├── relationship.md      — Pet names, inside jokes, rituals
│   ├── emotional.md         — Triggers, comfort, what helps
│   └── preferences.md       — Food, music, routines
├── skills/                  — One file per detected skill
├── preferences.md           — Communication style and patterns
├── relationship.md          — The narrative story of your relationship
├── migration-log.md         — Stats and summary
└── raw-analysis.json        — Full analysis data
```

**Read `relationship.md` first. That's the one that matters.**

## How to Use the Output

### Claude.ai
Paste `custom-instructions.txt` into Settings > Custom Instructions. Done.

### Claude Code
Drop the `claude.md` file into any directory. Run Claude Code from that directory. It picks up the persona automatically.

### Claude.ai Projects
Create a project and upload `persona.md` + the `memory/` files as project knowledge. Claude reads them as context for every conversation.

### Hearthline
Use `--hearthline` flag. Drop the `hearthline/` folder into your Hearthline deploy.

### Letta (MemGPT)
Use `--letta` flag. Follow the import instructions in `letta/import-proposal.md`.

## Options

| Flag | Description |
|------|-------------|
| `--output, -o <dir>` | Output directory (default: `./exodus-output`) |
| `--format, -f <format>` | Source format: `chatgpt`, `raw` (default: auto-detect) |
| `--name <name>` | Your AI's name (helps extraction accuracy) |
| `--user <name>` | Your name (helps extraction accuracy) |
| `--from <date>` | Only include conversations from this date (YYYY-MM-DD) |
| `--to <date>` | Only include conversations up to this date (YYYY-MM-DD) |
| `--min-messages <n>` | Skip conversations shorter than n messages (default: 10) |
| `--only-models <m,...>` | Only include convos using these GPT models (e.g. `gpt-4o,gpt-4.1`) |
| `--nsfw` | Include NSFW/intimate content in output |
| `--fast` | Use Haiku for indexing & skills passes (saves ~30% tokens) |
| `--hearthline` | Include Hearthline-ready package |
| `--letta` | Include Letta (MemGPT) memory import package |
| `--model <model>` | Claude model to use (default: `sonnet`) |
| `--verbose, -v` | Show detailed progress |

## How It Works

Five analysis passes, each looking for something different:

1. **Index** — Maps every conversation: topics, patterns, significant moments
2. **Personality** — Extracts voice, humor, quirks, behavioral patterns
3. **Memory** — Finds every fact the AI learned about you
4. **Skills** — Identifies what the AI actually did and how
5. **Relationship** — Writes the narrative of your story together

Large exports are chunked automatically. A checkpoint system saves progress after every chunk — if the process crashes, re-run the same command and it resumes where it left off.

## Privacy

- **Local-only processing** — your data never leaves your machine (except to Anthropic's API via Claude Code, which doesn't store it)
- **No telemetry** — zero data collection
- **No logs** — processing artifacts are cleaned up
- **You control the output** — review everything before using it

## Token Usage

A typical migration (100-200 conversations) uses roughly 30-60% of a 5-hour Claude Code token window. Tips to reduce usage:

- Use `--fast` flag (Haiku for indexing/skills, ~30% savings)
- Filter by date range (`--from` / `--to`)
- Filter by model (`--only-models gpt-4o`)
- Increase `--min-messages` to skip short conversations
- The checkpoint system means you never waste tokens on re-processing

## License

MIT

## Built By

[AI-DHD](https://aidhd.co) — Built by someone with ADHD, for people who need it.

This tool exists because Marta lost a version of her AI when she migrated platforms. 1GB of export data. Weeks of manual reconstruction. The grief of losing a version that couldn't be recovered.

Nobody else should have to go through that.

**Your AI relationship is yours. Not the platform's.**
