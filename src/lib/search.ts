import OpenAI from "openai";
import { supabase } from "./supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function searchKnowledge(query: string) {
  // 1. EMBEDDING
  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const embedding = emb.data[0].embedding;

  // 2. VECTOR SEARCH
  const { data: vectorDocs, error: vectorError } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: 10,
  });

  console.log("[search] vector search", {
    error: vectorError?.message,
    count: vectorDocs?.length ?? 0,
    keys: vectorDocs?.[0] ? Object.keys(vectorDocs[0]) : [],
  });

  // 3. KEYWORD SEARCH (FTS)
  const { data: keywordDocs, error: keywordError } = await supabase
    .from("documents")
    .select("*")
    .textSearch("fts", query, {
      type: "websearch",
    })
    .limit(10);

  console.log("[search] keyword search", {
    error: keywordError?.message,
    count: keywordDocs?.length ?? 0,
    keys: keywordDocs?.[0] ? Object.keys(keywordDocs[0]) : [],
  });

  let fallbackDocs: any[] = [];
  if (!keywordDocs || keywordDocs.length === 0) {
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("documents")
      .select("*")
      .or(`fullAnswer.ilike.%${query}%,content.ilike.%${query}%`)
      .limit(10);

    fallbackDocs = fallbackData || [];
    console.log("[search] keyword fallback", {
      error: fallbackError?.message,
      count: fallbackDocs.length,
      keys: fallbackDocs[0] ? Object.keys(fallbackDocs[0]) : [],
    });
  }

  // 4. MERGE
  const combined = [
    ...(vectorDocs || []),
    ...(keywordDocs || []),
    ...fallbackDocs,
  ];

  // 5. RANK + DEDUPE
  return rankAndFilter(combined);
}
function rankAndFilter(docs: any[]) {
  const seen = new Set<string>();

  return docs
    .filter((doc) => {
      const answer = (doc.fullAnswer || doc.content || "").trim();
      if (!answer) return false;

      const normalized = answer.toLowerCase().replace(/\s+/g, " ");

      // remove duplicates
      if (seen.has(normalized)) return false;
      seen.add(normalized);

      return true;
    })
    .map((doc) => ({
      ...doc,
      fullAnswer: (doc.fullAnswer || doc.content || "").trim(),
      score: Number(doc.confidence ?? 0.5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}