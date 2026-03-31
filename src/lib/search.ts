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
  const { data: vectorDocs } = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: 10,
  });

  // 3. KEYWORD SEARCH (FTS)
  const { data: keywordDocs } = await supabase
    .from("documents")
    .select("*")
    .textSearch("fts", query, {
      type: "websearch",
    })
    .limit(10);

  // 4. MERGE
  const combined = [...(vectorDocs || []), ...(keywordDocs || [])];

  // 5. RANK + DEDUPE
  return rankAndFilter(combined);
}
function rankAndFilter(docs: any[]) {
  const seen = new Set<string>();

  return docs
    .filter((doc) => {
      if (!doc.fullAnswer) return false;

      // remove duplicates
      if (seen.has(doc.fullAnswer)) return false;
      seen.add(doc.fullAnswer);

      return true;
    })
    .map((doc) => ({
      ...doc,
      score: (doc.confidence || 0.5),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}