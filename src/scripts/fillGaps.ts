import "dotenv/config";
import OpenAI from "openai";
import { supabase } from "../lib/supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function fillGaps() {
  const { data: gaps } = await supabase
    .from("knowledge_gaps")
    .select("*")
    .limit(10);

  if (!gaps || gaps.length === 0) {
    console.log("No gaps 🎉");
    return;
  }

  for (const gap of gaps) {
    console.log("Filling gap:", gap.query);

    // 1️⃣ generate answer
    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      input: `Answer for a rental business in Haiphong:\n${gap.query}`,
    });

    const text = response.output_text;

    // 2️⃣ embed
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    // 3️⃣ store
    await supabase.from("documents").insert({
      slug: "auto",
      question: gap.query,
      fullAnswer: text,
      shortSnippet: text.slice(0, 120),
      source: "ai-generated",
      confidence: 0.5,
      vector: emb.data[0].embedding,
    });
  }
}

fillGaps();