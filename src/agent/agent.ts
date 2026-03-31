import OpenAI from "openai";
import { searchKnowledge } from "../lib/search.js";
import { buildContext } from "../lib/context.js";
import { detectIntent } from "../lib/intent.js";
import { buildSystemPrompt } from "../prompts/system.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function askAgent(userMessage: string) {
  const intent = detectIntent(userMessage);

  // 1. SEARCH
  const docs = await searchKnowledge(userMessage);

  // 2. HARD FILTER
  const threshold = intent === "business" ? 0.65 : 0.55;
  const filtered = docs.filter((d) => (d.score ?? d.confidence ?? 0) >= threshold);

  if (!filtered.length) {
    return "I'm not sure about that, let me check with our team.";
  }

  // 3. CONTEXT
  const context = buildContext(filtered);

  // 4. LLM
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: buildSystemPrompt(),
      },
      {
        role: "user",
        content: `
Context:
${context}

Question:
${userMessage}
        `,
      },
    ],
  });

  const answer = res.choices[0].message.content;

  // 5. GUARDRAIL
  if (!answer || answer.length < 10) {
    return "I'm not sure about that, let me check with our team.";
  }

  return answer;
}