import OpenAI from "openai";
import { supabase } from "./supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function searchKnowledge(query: string) {
  let vectorDocs: any[] = [];
  let vectorError: any = null;

  const emb = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });
  const embedding = emb.data[0].embedding;

  const vectorAttemptA = await supabase.rpc("match_documents", {
    query_embedding: embedding,
    match_count: 10,
  });
  vectorDocs = vectorAttemptA.data || [];
  vectorError = vectorAttemptA.error;

  if (vectorError && /match_documents/i.test(vectorError.message || "")) {
    const vectorAttemptB = await supabase.rpc("match_documents", {
      query_vector: embedding,
      top_k: 10,
    });
    vectorDocs = vectorAttemptB.data || [];
    vectorError = vectorAttemptB.error;
  }

  console.log("[search] vector search", {
    error: vectorError?.message ?? vectorError,
    count: vectorDocs?.length ?? 0,
    keys: vectorDocs?.[0] ? Object.keys(vectorDocs[0]) : [],
  });

  const keywordResult = await supabase
    .from("documents")
    .select("*")
    .textSearch("fts", query, {
      type: "websearch",
    })
    .limit(10);

  const keywordDocs = keywordResult.data || [];
  const keywordError = keywordResult.error;

  console.log("[search] keyword search", {
    error: keywordError?.message,
    count: keywordDocs.length,
    keys: keywordDocs[0] ? Object.keys(keywordDocs[0]) : [],
  });

  let fallbackDocs: any[] = [];
  if (!keywordDocs.length) {
    const keywordOr = buildKeywordOr(query);
    const { data: fallbackData, error: fallbackError } = await supabase
      .from("documents")
      .select("*")
      .or(keywordOr)
      .limit(10);

    fallbackDocs = fallbackData || [];
    console.log("[search] keyword fallback", {
      error: fallbackError?.message,
      count: fallbackDocs.length,
      keys: fallbackDocs[0] ? Object.keys(fallbackDocs[0]) : [],
    });
  }

  const combined = [
    ...(vectorDocs || []).map((doc) => ({ ...doc, _matchType: "vector" })),
    ...keywordDocs.map((doc) => ({ ...doc, _matchType: "keyword" })),
    ...fallbackDocs.map((doc) => ({ ...doc, _matchType: "fallback" })),
  ];

  return rankAndFilter(combined);
}

function tokenizeQuery(query: string) {
  const cleaned = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  return Array.from(
    new Set(
      cleaned
        .split(/\s+/)
        .map((t) => t.trim())
        .filter((t) => t.length >= 3)
    )
  );
}

function buildKeywordOr(query: string) {
  const terms = tokenizeQuery(query);
  const searchTerms = terms.length ? terms : [query.trim()];
  const columns = ["fullAnswer", "content", "question", "title", "shortSnippet"];

  return searchTerms
    .flatMap((term) => columns.map((col) => `${col}.ilike.%${term}%`))
    .join(",");
}

function rankAndFilter(docs: any[]) {
  const seen = new Set<string>();

  return docs
    .filter((doc) => {
      const answer = (doc.fullAnswer || doc.content || "").trim();
      if (!answer) return false;

      const normalized = answer.toLowerCase().replace(/\s+/g, " ");

      if (seen.has(normalized)) return false;
      seen.add(normalized);

      return true;
    })
    .map((doc) => {
      const rawScore = Number(doc.confidence ?? NaN);
      const fallbackScore =
        doc._matchType === "keyword"
          ? 0.7
          : doc._matchType === "fallback"
          ? 0.65
          : 0.6;
      return {
        ...doc,
        fullAnswer: (doc.fullAnswer || doc.content || "").trim(),
        score: Number.isFinite(rawScore) ? rawScore : fallbackScore,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}