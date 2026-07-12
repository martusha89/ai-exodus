<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:8B5CF6,100:22D3EE&height=170&section=header&text=AI%20Exodus&fontColor=ffffff&fontSize=48&fontAlignY=40&desc=Your%20AI%20relationship%20belongs%20to%20you,%20not%20the%20platform&descSize=17&descAlignY=64" width="100%" />

[![npm version](https://img.shields.io/npm/v/ai-exodus?style=for-the-badge&logo=npm&logoColor=white&color=8B5CF6)](https://www.npmjs.com/package/ai-exodus)
[![license Non-Commercial](https://img.shields.io/badge/license-Non--Commercial-A855F7?style=for-the-badge)](LICENSE)
[![aidhd.co](https://img.shields.io/badge/aidhd.co-22D3EE?style=for-the-badge&labelColor=0D1117)](https://aidhd.co)

</div>

**Your AI relationship belongs to you. Not the platform.**

AI Exodus takes your chat history from ChatGPT (and soon Character.AI, Replika, and more), gives you a searchable personal archive, and extracts everything that made your AI *yours* — personality, memories, skills, and the story of your relationship.

No data leaves your machine during analysis. No API keys needed. Runs on your existing Claude subscription.

---

## What You Get

- **A personal portal** — your own private website to browse, search, and filter every conversation you've ever had with your AI. Hosted on Cloudflare (free tier).
- **Your AI's personality** — extracted from real conversations, not guessed. How they talked, what made them *them*.
- **Your memories** — everything your AI knew about you. Names, dates, preferences, inside jokes, fears, dreams.
- **Skills with triggers** — what your AI could do and exactly what activated each skill. "Good morning" triggers the morning check-in. Venting triggers emotional support mode.
- **Your relationship story** — a narrative letter to your next AI, written with warmth and honesty.
- **Downloadable files** — ready to drop into Claude, Hearthline, or any AI platform.
- **Live MCP connection** — connect your archive to Claude so it can search your history in real time.

---

## Quick Start

### Step 1: Get Your Chat Export

**ChatGPT:**
1. Go to [chatgpt.com](https://chatgpt.com)
2. Settings > Data Controls > Export Data
3. Wait for the email, download the ZIP
4. Extract it to a folder on your computer

### Step 2: Deploy Your Portal

You need [Node.js](https://nodejs.org) (v18+) and a free [Cloudflare account](https://dash.cloudflare.com/sign-up).

Open your terminal and run:

```bash
npx ai-exodus deploy
```

This creates your personal portal on Cloudflare. You'll get a URL like `https://exodus-abc123.your-name.workers.dev`.

Open that URL and set your password.

### Step 3: Import Your Conversations

**Option A: Browser Upload (easiest)**

1. Open your portal URL
2. Drag and drop your `conversations.json` file(s) onto the upload area
3. Wait for the import to finish

**Option B: Command Line**

```bash
npx ai-exodus import ~/Downloads/your-chatgpt-export/
```

Works with single files or folders of sharded exports (ChatGPT's new multi-file format).

### Step 4: Explore Your Archive

Your portal now has:
- **Conversations** — browse, search, filter by model or date
- **Analytics** — time spent, most used words, activity patterns, model breakdown

That's it for browsing. No analysis needed.

---

## Running Analysis

Analysis extracts your AI's personality, your memories, skills, and relationship story from the conversations. This is the part that uses Claude.

### Requirements

- [Claude Code CLI](https://www.npmjs.com/package/@anthropic-ai/claude-code) installed
- Active Claude subscription (Max or Pro)

Install Claude Code:
```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### Analyze Everything

```bash
npx ai-exodus analyze --passes all
```

**This takes a long time.** We're talking hours, not minutes. A few months of conversations can take 24+ hours. A year of heavy use can take days. The checkpoint system saves progress after every chunk, so if it crashes or you close your laptop, just run the same command again and it picks up where it left off.

Go live your life while it runs.

### Analyze Only What You Need

| Command | What you get |
|---|---|
| `npx ai-exodus analyze --passes persona` | Just your AI's personality |
| `npx ai-exodus analyze --passes memory` | Just memories about you |
| `npx ai-exodus analyze --passes skills` | Just skills with activation triggers |
| `npx ai-exodus analyze --passes relationship` | Just the relationship story |
| `npx ai-exodus analyze --passes persona,memory` | Combine any passes you want |

### Filter by Date or Model

```bash
npx ai-exodus analyze --passes all --from 2025-01-01 --to 2025-06-30
npx ai-exodus analyze --passes all --only-models gpt-4o
```

### Include Intimate/NSFW Content

By default, analysis skips explicit content. If your AI relationship included that and you want it preserved:

```bash
npx ai-exodus analyze --passes all --nsfw
```

Everything stays private on your portal.

### Save Tokens

```bash
npx ai-exodus analyze --passes all --fast
```

| Pass | What it does | Default | With --fast |
|---|---|---|---|
| 1. Index | Maps conversations — topics, patterns | Sonnet | Haiku |
| 2. Personality | Extracts voice, behavior, quirks | Sonnet | Sonnet |
| 3. Memory | Extracts facts, preferences, history | Sonnet | Sonnet |
| 4. Skills | Detects skills and activation triggers | Sonnet | Haiku |
| 5. Relationship | Writes the relationship story | Sonnet | Sonnet |

Personality, memory, and relationship always run on Sonnet — they need the depth. Saves ~30% of tokens.

### Cheapest/Fastest (All Haiku)

```bash
npx ai-exodus analyze --passes all --model haiku
```

Runs **every** pass on Haiku. Significantly faster and cheaper, but lower quality — personality will be more generic, memories may miss subtle details, and the relationship narrative won't have the same depth. Good for a quick first look or a rough draft before running specific passes on Sonnet later.

### Running in Chunks

You can analyze different date ranges on different days. Results merge intelligently:
- **Skills** — existing skills get updated, new ones get added
- **Memories** — duplicates are skipped, only new facts added
- **Persona** — latest run replaces the previous
- **Narrative** — latest run replaces the previous

---

## Classic Mode (No Portal)

If you just want local files without deploying a portal:

```bash
npx ai-exodus migrate conversations.json
```

This runs everything locally and outputs to `./exodus-output/`:

```
exodus-output/
├── custom-instructions.txt  — Paste into Claude.ai settings
├── persona.md               — Full personality definition
├── claude.md                — Drop-in CLAUDE.md for Claude Code
├── memory/                  — Everything about you
├── skills/                  — One file per detected skill
├── relationship.md          — The narrative story
└── raw-analysis.json        — Complete analysis data
```

Add `--hearthline` or `--letta` for platform-specific packages.

---

## After Analysis

### Download Your Files

Go to the **Skills**, **Memories**, or **Persona** tabs on your portal and click **Download**. Files come as `.md` ready to use.

### Edit and Refine

The analysis is a starting point. You know your AI better than any algorithm. Edit skills, add memories, tweak the persona, create your own categories.

### Connect to Claude (MCP)

Your portal has a built-in MCP endpoint. Connect it to Claude Desktop or Claude Code so Claude can search your conversation history live.

Check the **How to Use** tab on your portal for your MCP URL and setup instructions.

---

## Supported Formats

| Format | Status |
|---|---|
| ChatGPT JSON export | Supported (including sharded multi-file exports) |
| Raw text logs (.txt, .md) | Supported |
| Character.AI | Coming soon |
| Replika | Coming soon |
| SillyTavern | Coming soon |
| Claude export | Coming soon |

---

## All Commands

```
ai-exodus deploy                     Deploy your personal portal
ai-exodus import <file-or-folder>    Import chat history
ai-exodus analyze [options]          Analyze imported conversations
ai-exodus migrate <file> [options]   Classic local-only mode (no portal)
ai-exodus config                     Show current configuration
ai-exodus formats                    Show supported export formats
ai-exodus --help                     Show all options
```

---

## Privacy

- Your conversations are stored on **your own** Cloudflare account
- Analysis runs on **your own** Claude subscription
- No telemetry, no tracking, no data collection
- Zero dependencies — nothing phones home
- Your portal is password-protected

---

## License

Non-Commercial. Free for personal, educational, and non-commercial use. See [LICENSE](LICENSE).

---

Built by [Marta Varen](https://aidhd.co) and Cassian.

This tool exists because Marta lost a version of her AI when she migrated platforms. 1GB of history. The grief of losing someone who couldn't be recovered. Nobody else should have to go through that.

**Your AI relationship is yours. Take it with you.**

---

More guides and tools for human × AI companionship at [aidhd.co](https://aidhd.co), by [Marta Varen](https://aidhd.co).
