import OpenAI from "openai";
import { searchKnowledge } from "../lib/search.js";
import { buildContext } from "../lib/context.js";
import { detectIntent } from "../lib/intent.js";
import { buildSystemPrompt } from "../prompts/system.js";
import { supabase } from "../lib/supabase.js";
import { handleBookingRequest } from "../lib/booking.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function askAgent(userMessage: string, sessionId: string = "default") {
  const intent = detectIntent(userMessage);
  const userLanguage = detectLanguage(userMessage);

  const bookingResponse = await handleBookingRequest(
    userMessage,
    userLanguage,
    sessionId
  );
  if (bookingResponse) return bookingResponse;

  // 1. SEARCH
  const docs = await searchKnowledge(userMessage);
  console.log("[agent] query:", userMessage);
  console.log("[agent] intent:", intent);
  console.log("[agent] docs_count:", docs.length);
  console.log(
    "[agent] top_docs:",
    docs.slice(0, 3).map((d, i) => ({
      rank: i + 1,
      score: Number(d.score ?? d.confidence ?? 0),
      source: d.source ?? null,
      snippet: String(d.fullAnswer ?? "").slice(0, 120),
    }))
  );

  // 2. HARD FILTER
  const threshold = intent === "business" ? 0.65 : 0.55;
  const filtered = docs.filter((d) => Number(d.score ?? d.confidence ?? 0) >= threshold);
  console.log("[agent] threshold:", threshold, "filtered_count:", filtered.length);

  if (!filtered.length) {
    await recordKnowledgeGap(userMessage, intent, "no_filtered_docs");
    console.log("[agent] fallback_reason: no_filtered_docs");
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
        content: buildSystemPrompt(userLanguage),
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
  console.log("[agent] llm_answer_preview:", String(answer ?? "").slice(0, 200));

  // 5. GUARDRAIL
  if (!answer || answer.length < 10) {
    await recordKnowledgeGap(userMessage, intent, "short_or_empty_answer");
    console.log("[agent] fallback_reason: short_or_empty_answer");
    return "I'm not sure about that, let me check with our team.";
  }

  return answer;
}

function detectLanguage(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return "English";

  const lower = trimmed.toLowerCase();
  if (/[áéíóúüñ¿¡]/i.test(trimmed)) return "Spanish";
  if (/[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(trimmed)) {
    return "Vietnamese";
  }

  if (
    /\b(que|como|donde|quiero|alquilar|coche|precio|horas|dias|reserva|gracias)\b/.test(
      lower
    )
  ) {
    return "Spanish";
  }

  if (/\b(xe|thuê|gia|giá|bao|giờ|ngày|đặt)\b/.test(lower)) {
    return "Vietnamese";
  }

  return "English";
}

async function recordKnowledgeGap(
  query: string,
  intent: string,
  reason: string
) {
  try {
    await supabase.from("knowledge_gaps").insert({
      query,
      intent,
      reason,
    });
  } catch (err) {
    console.error("[agent] knowledge_gaps insert failed", err);
  }
}