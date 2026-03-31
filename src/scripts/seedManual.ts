import "dotenv/config";
import OpenAI from "openai";
import { supabase } from "../lib/supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const entries = [
  {
    slug: "motorbike-rental",
    question: "Do you rent motorbikes?",
    fullAnswer:
      "Yes, RiverCity offers motorbike rentals in Haiphong. We provide both automatic and manual scooters, suitable for city travel and longer trips.",
    shortSnippet: "Motorbike rentals available in Haiphong.",
  },
  {
    slug: "car-rental",
    question: "Do you rent cars?",
    fullAnswer:
      "Yes, RiverCity offers car rentals in Haiphong. Options include self-drive and chauffeur-driven vehicles.",
    shortSnippet: "Car rentals available.",
  },
  {
    slug: "no-bicycles",
    question: "Do you rent bicycles?",
    fullAnswer:
      "No, RiverCity does not offer bicycle rentals. We specialize in motorbikes and cars.",
    shortSnippet: "No bicycle rentals.",
  },
];

async function seed() {
  for (const entry of entries) {
    console.log("Seeding:", entry.question);

    // 🔑 IMPORTANT: embed question + answer together
    const text = `${entry.question}\n${entry.fullAnswer}`;

    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });

    await supabase.from("documents").insert({
      ...entry,
      source: "manual",
      confidence: 1.0,
      vector: emb.data[0].embedding,
    });
  }

  console.log("✅ Manual knowledge inserted");
}

seed();