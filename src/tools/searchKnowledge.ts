import OpenAI from "openai";
import { supabase } from "../lib/supabase";
import { Document } from "../types/document";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export async function searchKnowledge(
  query: string,
  topK: number = 3
): Promise<Document[]> {
  try {
    // 1️⃣ Embed user query
    const embeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: query,
    });
    const queryVector = embeddingResponse.data[0].embedding;

    // 2️⃣ Call Supabase RPC for vector search
    const { data, error } = await supabase.rpc("match_documents", {
      query_vector: queryVector,
      top_k: topK,
    });

    if (error) {
      console.error("Supabase search error:", error);
      return [];
    }

    // 3️⃣ Cast to shared Document type
    return (data as Document[]).map((doc) => ({
      ...doc,
      id: String(doc.id),
    }));
  } catch (err) {
    console.error("searchKnowledge error:", err);
    return [];
  }
}