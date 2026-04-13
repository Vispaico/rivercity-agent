import OpenAI from "openai";
import { searchKnowledge } from "../lib/search.js";
import { buildContext } from "../lib/context.js";
import { detectIntent } from "../lib/intent.js";
import { buildSystemPrompt } from "../prompts/system.js";
import { supabase } from "../lib/supabase.js";
import {
  formatAvailabilityList,
  getAvailableVehicles,
  handleBookingRequest,
} from "../lib/booking.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";
const LANG_MODEL = process.env.OPENAI_LANG_MODEL ?? "gpt-4o-mini";
const MAX_COMPLETION_TOKENS = Number(process.env.OPENAI_MAX_TOKENS ?? 350);

const SUPPORTED_LANGUAGES = [
  "English",
  "Spanish",
  "Vietnamese",
  "French",
  "German",
  "Italian",
  "Portuguese",
  "Thai",
  "Chinese",
  "Japanese",
  "Korean",
  "Indonesian",
];

const languageCache = new Map<string, { language: string; expiresAt: number }>();
const LANGUAGE_CACHE_TTL_MS = Number(process.env.LANGUAGE_CACHE_TTL_MS ?? 3_600_000);

export async function askAgent(userMessage: string, sessionId: string = "default") {
  const intent = detectIntent(userMessage);
  const userLanguage = await detectLanguage(userMessage, sessionId);

  const bookingResponse = await handleBookingRequest(
    userMessage,
    userLanguage,
    sessionId
  );
  if (bookingResponse) return bookingResponse;

  if (isVehicleListInquiry(userMessage)) {
    const availableVehicles = await getAvailableVehicles();
    if (availableVehicles.length) {
      return formatAvailabilityList(userLanguage, availableVehicles);
    }
  }

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
  const threshold = intent === "business" ? 0.55 : 0.5;
  const filtered = docs.filter((d) => Number(d.score ?? d.confidence ?? 0) >= threshold);
  console.log("[agent] threshold:", threshold, "filtered_count:", filtered.length);

  if (!filtered.length) {
    if (docs.length) {
      await recordKnowledgeGap(userMessage, intent, "low_score_docs");
      console.log("[agent] fallback_reason: low_score_docs");
      return buildClarifyingQuestion(intent, userLanguage);
    }

    await recordKnowledgeGap(userMessage, intent, "no_filtered_docs");
    console.log("[agent] fallback_reason: no_filtered_docs");
    return "I'm not sure about that, let me check with our team.";
  }

  // 3. CONTEXT
  const context = buildContext(filtered);

  // 4. LLM
  const res = await openai.chat.completions.create({
    model: CHAT_MODEL,
    temperature: 0.2,
    max_tokens: MAX_COMPLETION_TOKENS,
    user: sessionId,
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

async function detectLanguage(text: string, sessionId: string) {
  const trimmed = text.trim();
  if (!trimmed) return "English";

  const cached = languageCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.language;
  }

  const requested = extractRequestedLanguage(trimmed);
  if (requested) {
    languageCache.set(sessionId, {
      language: requested,
      expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS,
    });
    return requested;
  }

  const heuristic = heuristicDetectLanguage(trimmed);
  if (heuristic) {
    languageCache.set(sessionId, {
      language: heuristic,
      expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS,
    });
    return heuristic;
  }

  if (trimmed.length < 4) return "English";

  try {
    const detection = await openai.chat.completions.create({
      model: LANG_MODEL,
      temperature: 0,
      max_tokens: 12,
      messages: [
        {
          role: "system",
          content: `Detect the language of the user message and respond with ONLY one of: ${SUPPORTED_LANGUAGES.join(
            ", "
          )}. If unsure, respond with English.`,
        },
        {
          role: "user",
          content: trimmed.slice(0, 240),
        },
      ],
      user: sessionId,
    });

    const raw = String(detection.choices[0]?.message?.content ?? "").trim();
    const normalized = normalizeLanguage(raw);
    const finalLanguage = SUPPORTED_LANGUAGES.includes(normalized)
      ? normalized
      : "English";
    languageCache.set(sessionId, {
      language: finalLanguage,
      expiresAt: Date.now() + LANGUAGE_CACHE_TTL_MS,
    });
    return finalLanguage;
  } catch (err) {
    console.error("[agent] language detection failed", err);
    return "English";
  }
}

function heuristicDetectLanguage(text: string) {
  const lower = text.toLowerCase();
  if (/[áéíóúüñ¿¡]/i.test(text)) return "Spanish";
  if (/[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(text)) {
    return "Vietnamese";
  }

  if (
    /\b(que|como|donde|quiero|alquilar|coche|precio|horas|dias|reserva|gracias)\b/.test(
      lower
    )
  ) {
    return "Spanish";
  }

  if (/\b(xe|thuê|gia|giá|bao|giờ|ngày|đặt|cảm ơn)\b/.test(lower)) {
    return "Vietnamese";
  }

  return null;
}

function extractRequestedLanguage(text: string) {
  const lower = text.toLowerCase();
  const patterns = [
    /\b(answer|respond|reply|write|speak)\s+(in|using)\s+([a-záéíóúüñàèìòùâêîôûäëïöüãõ\s]+)\b/i,
    /\b(en|em)\s+(español|português|portugues|français|deutsch|italiano|tiếng việt|vietnamese|spanish|english|french|german|italian|portuguese)\b/i,
  ];

  for (const pattern of patterns) {
    const match = lower.match(pattern);
    if (match) {
      const phrase = (match[3] || match[2] || "").trim();
      const normalized = normalizeLanguage(phrase);
      if (SUPPORTED_LANGUAGES.includes(normalized)) return normalized;
    }
  }

  return null;
}

function normalizeLanguage(input: string) {
  const cleaned = input.trim().toLowerCase();
  const map: Record<string, string> = {
    english: "English",
    ingles: "English",
    español: "Spanish",
    espanol: "Spanish",
    spanish: "Spanish",
    vietnamese: "Vietnamese",
    "tiếng việt": "Vietnamese",
    vietnam: "Vietnamese",
    français: "French",
    francais: "French",
    french: "French",
    deutsch: "German",
    german: "German",
    italiano: "Italian",
    italian: "Italian",
    português: "Portuguese",
    portugues: "Portuguese",
    portuguese: "Portuguese",
    thai: "Thai",
    chinese: "Chinese",
    japanese: "Japanese",
    korean: "Korean",
    indonesian: "Indonesian",
  };

  return map[cleaned] ?? cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function isVehicleListInquiry(message: string) {
  return /\b(what.*(vehicles|motorbikes|bikes|cars)|vehicles available|available vehicles|what do you have|price list|price per day|pricing|rentals list)\b/i.test(
    message
  );
}

function buildClarifyingQuestion(intent: string, language: string) {
  if (language === "Spanish") {
    if (intent === "business") {
      return "¿Qué tipo de vehículo y qué fechas te interesan?";
    }
    return "¿Puedes dar un poco más de detalle para ayudarte mejor?";
  }

  if (language === "Vietnamese") {
    if (intent === "business") {
      return "Bạn cần loại xe nào và ngày thuê cụ thể nào?";
    }
    return "Bạn có thể cho mình thêm chi tiết được không?";
  }

  if (intent === "business") {
    return "Which vehicle type and dates are you interested in?";
  }

  return "Could you share a bit more detail so I can help?";
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