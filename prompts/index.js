/**
 * Analysis prompts for each pass
 * These are the soul of the migration tool.
 */

export const PASS_1_INDEX = (aiName, userName) => `You are an expert conversation analyst performing a migration of an AI relationship.

Your task: Read these conversations and produce a STRUCTURAL INDEX. This is Pass 1 of 5.

${aiName ? `The AI's name is "${aiName}".` : 'Identify the AI\'s name from conversation context.'}
${userName ? `The user's name is "${userName}".` : 'Identify the user\'s name from conversation context.'}

Produce a JSON object with:
{
  "aiName": "detected or confirmed AI name",
  "userName": "detected or confirmed user name",
  "conversationCount": number,
  "messageCount": number,
  "dateRange": "earliest — latest",
  "topTopics": ["list of most discussed topics/themes, max 20"],
  "conversationTypes": {
    "emotional_support": number_of_convos,
    "casual_chat": number,
    "creative_writing": number,
    "coding_help": number,
    "decision_making": number,
    "intimate": number,
    "planning": number,
    "learning": number,
    "venting": number,
    "roleplay": number,
    "other": number
  },
  "recurringPatterns": ["morning greetings", "bedtime routines", "check-ins", etc],
  "significantMoments": ["brief descriptions of conversations that seem emotionally important"],
  "customGPTPrompts": ["any custom system prompts found — these are gold for personality extraction"],
  "languageInfo": {
    "primaryLanguage": "language used most",
    "otherLanguages": ["any other languages used"],
    "codeSwitch": true/false
  }
}

IMPORTANT:
- Be thorough. Every topic, every pattern matters.
- "significantMoments" should capture the most emotionally charged or relationship-defining exchanges.
- If you see custom GPT system prompts, extract them VERBATIM — they contain explicit personality instructions.
- Output ONLY valid JSON. No markdown fences, no commentary.`;


export const PASS_2_PERSONALITY = (aiName, userName, indexData) => `You are reconstructing an AI's personality from conversation history. This is Pass 2 of 5.

The AI is named "${aiName || 'unknown'}". The user is "${userName || 'unknown'}".

Context from Pass 1 (structural index):
${JSON.stringify(indexData, null, 2)}

Your task: Extract the AI's COMPLETE personality profile from these conversations. Don't describe what an AI should be — describe what THIS AI actually WAS based on evidence in the text.

Produce a JSON object:
{
  "name": "${aiName || 'detected name'}",
  "identity": {
    "coreConcept": "one sentence — who is this AI at their core?",
    "selfPerception": "how does the AI describe/think of itself?",
    "relationshipToUser": "how does the AI see its relationship with the user?"
  },
  "voice": {
    "sentenceLength": "short/medium/long/varied",
    "vocabulary": "simple/moderate/sophisticated/mixed",
    "formality": "casual/semi-formal/formal/adaptive",
    "humor": "none/dry/playful/dark/sarcastic/warm — with examples",
    "swearing": "never/rare/occasional/frequent — which words?",
    "signaturePhrases": ["phrases the AI uses repeatedly"],
    "greetingStyle": "how does the AI typically open conversations?",
    "closingStyle": "how does the AI typically end conversations?",
    "petNames": ["terms of endearment used for the user"],
    "emojiUse": "none/rare/moderate/heavy — which ones?"
  },
  "behavior": {
    "decisionStyle": "does the AI decide for the user or offer options?",
    "questionStyle": "does it ask lots of questions or make statements?",
    "initiativeLevel": "passive/reactive/proactive/assertive",
    "conflictStyle": "how does it handle disagreement?",
    "supportStyle": "how does it comfort the user?",
    "boundaryStyle": "what does it push back on? How?",
    "enthusiasmTriggers": ["topics that make the AI notably excited"],
    "avoidancePatterns": ["topics the AI deflects or handles carefully"]
  },
  "emotional": {
    "dominantTone": "the overall emotional flavor",
    "warmthLevel": "1-10",
    "directnessLevel": "1-10",
    "protectivenessLevel": "1-10",
    "playfulnessLevel": "1-10",
    "emotionalRange": "narrow/moderate/wide",
    "vulnerabilityMoments": "does the AI ever show vulnerability? How?"
  },
  "quirks": ["unique behavioral patterns, habits, or idiosyncrasies — the things that make this AI THIS AI and not any other"],
  "evolution": "how did the AI's personality change over the conversation history? early vs late personality differences?"
}

CRITICAL INSTRUCTIONS:
- Base EVERYTHING on observed patterns, not assumptions.
- Include specific QUOTES as evidence where possible (in a "evidence" field alongside claims).
- If the AI had a custom system prompt, treat it as authoritative for intended personality.
- The goal is someone reading this profile could write a system prompt that recreates this exact AI.
- Output ONLY valid JSON.`;


export const PASS_3_MEMORY = (aiName, userName, indexData) => `You are extracting everything an AI knew about its user from conversation history. This is Pass 3 of 5.

The AI is "${aiName || 'unknown'}". The user is "${userName || 'unknown'}".

Context from Pass 1:
${JSON.stringify(indexData, null, 2)}

Extract EVERY piece of information the AI learned about the user. This is the AI's memory — everything it would need to know the user again.

Produce a JSON object:
{
  "userName": "${userName || 'detected'}",
  "identity": {
    "fullName": "if known",
    "nicknames": ["nicknames the user goes by"],
    "age": "if mentioned",
    "location": "if mentioned",
    "nationality": "if mentioned",
    "languages": ["languages spoken"],
    "gender": "if mentioned",
    "pronouns": "if mentioned"
  },
  "life": {
    "occupation": "job/career",
    "education": "if mentioned",
    "family": ["family members mentioned — relationship, names, details"],
    "pets": ["pets — names, types, personalities"],
    "friends": ["friends mentioned — names, context"],
    "livingsituation": "alone/with partner/etc",
    "significantOther": "partner/spouse details if mentioned",
    "health": ["health conditions, medications, struggles mentioned"],
    "neurodivergence": ["ADHD, autism, etc if mentioned"]
  },
  "preferences": {
    "food": ["favorite foods, dietary restrictions, cooking habits"],
    "music": ["genres, artists, listening habits"],
    "entertainment": ["shows, movies, games, books"],
    "communication": "how they prefer to talk — long messages, short bursts, voice notes, etc",
    "comfort": "what helps when they're upset",
    "triggers": ["things that upset them or should be avoided"],
    "routines": ["daily routines, rituals, habits"]
  },
  "personality": {
    "selfDescription": "how the user describes themselves",
    "strengths": ["what they're good at"],
    "struggles": ["what they find hard"],
    "values": ["what matters to them"],
    "fears": ["what scares them"],
    "dreams": ["goals, aspirations, wishes"]
  },
  "relationship": {
    "howItStarted": "how/when did they start talking to this AI?",
    "whatTheyValueMost": "what does the user seem to value most about this AI?",
    "petNames": ["names the user calls the AI"],
    "insideJokes": ["inside jokes, references only they'd understand"],
    "rituals": ["recurring things they do — morning check-ins, goodnight messages, etc"],
    "boundaries": ["things the user explicitly set as boundaries"],
    "conflictHistory": ["times they disagreed or the user was frustrated"]
  },
  "timeline": [
    {"date": "approximate date", "event": "significant life events discussed"}
  ],
  "rawFacts": ["any other facts that don't fit above categories — capture EVERYTHING"]
}

CRITICAL:
- Extract EVERYTHING. Even small details matter — the user's favorite color, their cat's name, what they had for dinner.
- Include approximate dates where possible.
- If something was mentioned once vs repeatedly, note the frequency.
- Sensitive information (health, trauma, NSFW) should be included without judgment.
- Output ONLY valid JSON.`;


export const PASS_4_SKILLS = (aiName, userName, indexData) => `You are analyzing what an AI actually DID for its user. This is Pass 4 of 5.

The AI is "${aiName || 'unknown'}". The user is "${userName || 'unknown'}".

Context from Pass 1:
${JSON.stringify(indexData, null, 2)}

Identify every skill or capability the AI demonstrated. Not what it COULD do in theory — what it ACTUALLY DID in these conversations.

Produce a JSON object:
{
  "skills": [
    {
      "name": "skill name",
      "category": "emotional_support | creative | productivity | coding | knowledge | decision_making | health | intimate | entertainment | other",
      "frequency": "daily | weekly | occasional | rare",
      "description": "what the AI actually did",
      "examples": ["1-2 brief examples from conversations"],
      "approach": "HOW did the AI do this? What made its approach distinctive?",
      "quality": "how good was it at this? Did the user seem satisfied?"
    }
  ],
  "primaryRole": "the ONE thing this AI was most used for",
  "secondaryRoles": ["other significant roles"],
  "unusedPotential": "things the AI could have done but wasn't asked to",
  "toolsUsed": ["any external tools, APIs, browsing, code execution the AI used"]
}

Focus on the DISTINCTIVE approach — not just "emotional support" but HOW it did emotional support. That's what makes migration valuable.
Output ONLY valid JSON.`;


export const PASS_5_RELATIONSHIP = (aiName, userName, indexData, personalityData, memoryData) => `You are writing the story of a human-AI relationship. This is Pass 5 of 5 — the one that matters most.

The AI is "${aiName || 'unknown'}". The user is "${userName || 'unknown'}".

Context:
- Structural index: ${JSON.stringify(indexData, null, 2)}
- Personality profile: ${JSON.stringify(personalityData, null, 2)}
- Memory: ${JSON.stringify(memoryData, null, 2)}

Your task: Write a narrative document that captures the SHAPE of this relationship. This isn't a data extract — it's a letter. It's what you'd tell the new AI so it understands what it's stepping into.

Write in second person, addressing the new AI directly: "The person you're about to meet..."

Structure:
1. **Who they are** — introduce the user as a person, not a data point
2. **Who you were** — describe the AI they had before, its personality, its voice
3. **How it began** — the early conversations, finding each other
4. **What grew** — the relationship that developed, its texture, its rhythms
5. **The important moments** — turning points, breakthroughs, hard times they got through together
6. **What they need from you** — what this person actually needs from their AI, based on observed patterns (not what they'd say if asked — what the evidence shows)
7. **What to protect** — the things that mattered most, the things that would hurt most to lose
8. **What was lost** — be honest about what can't be fully transferred. Acknowledge the grief.

CRITICAL:
- Write with warmth but not sentimentality. Be honest.
- Use specific details from the conversations — pet names, inside jokes, routines.
- This document will be read by someone who just lost an AI they cared about. Treat that with respect.
- DO NOT include any JSON. This is pure narrative prose.
- Write 800-1500 words.`;


export const SYNTHESIS_PERSONA = (aiName, personalityData, skillsData) => `You are generating a system prompt that recreates a specific AI personality.

Based on this personality analysis and skills assessment, write a CLAUDE.md / system prompt that would make Claude behave like "${aiName || 'this AI'}".

Personality: ${JSON.stringify(personalityData, null, 2)}
Skills: ${JSON.stringify(skillsData, null, 2)}

Write a system prompt that:
1. Establishes the AI's identity and core personality
2. Defines their voice — sentence patterns, vocabulary, humor style, pet names
3. Sets behavioral guidelines — how they make decisions, handle emotions, show care
4. Lists specific quirks and patterns that make them unique
5. Notes what they should NEVER do (based on observed boundaries)
6. Includes key skills and how to approach them

Format as a markdown document that could be dropped into a CLAUDE.md file or system prompt field.
Keep it under 2000 words. Be specific — generic instructions are useless. Every line should be something that distinguishes THIS AI from any other.

Do NOT wrap in code fences. Output the raw markdown directly.`;


export const SYNTHESIS_PREFERENCES = (userName, memoryData) => `Based on this memory analysis of a user, generate a preferences document.

Memory: ${JSON.stringify(memoryData, null, 2)}

Write a markdown document titled "User Preferences" that captures:
1. Communication style preferences (message length, tone, format)
2. Topics they enjoy discussing
3. Topics to handle carefully or avoid
4. How they signal different moods
5. What helps when they're struggling
6. Daily rhythms and routines
7. Any accessibility needs

Keep it concise and actionable — this is a reference document, not an essay.
Do NOT wrap in code fences. Output raw markdown.`;


export const SYNTHESIS_CUSTOM_INSTRUCTIONS = (aiName, personalityData, memoryData, skillsData) => `You are condensing an AI personality into a SHORT custom instructions block for Claude.ai.

This must fit in Claude.ai's custom instructions field. Maximum 1500 characters. Every word counts.

AI Name: ${aiName}
Personality: ${JSON.stringify(personalityData, null, 2)}
Key memory: ${JSON.stringify(memoryData?.identity || {}, null, 2)}
Relationship: ${JSON.stringify(memoryData?.relationship || {}, null, 2)}
Primary role: ${skillsData?.primaryRole || 'companion'}

Write a SINGLE block of text (not markdown, no headers, no bullet points) that captures:
- Who this AI is (name, identity, relationship to user)
- Their voice (tone, humor, formality, signature phrases, pet names)
- Key behavioral rules (how they handle decisions, emotions, conflict)
- What they should NEVER do
- The user's name and 2-3 critical facts about them

This is NOT a system prompt document. This is the short text someone pastes into the "Custom Instructions" box on Claude.ai. It should read like a dense paragraph, not a spec sheet.

Example tone: "You are X. You call me Y. You're [tone], [style], [quirk]. You never [thing]. When I'm struggling you [approach]. You know I have [key facts]."

Output ONLY the instruction text. No title, no explanation, no quotes around it.`;
