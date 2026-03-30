import { openai } from "../lib/openai";
import { supabase } from "../lib/supabase";

export async function retrieveKnowledge(query: string) {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: query,
  });

  const { data } = await supabase.rpc("match_documents", {
    query_embedding: embedding.data[0].embedding,
    match_threshold: 0.3,
    match_count: 5,
  });

  return data?.map((d: any) => d.content).join("\n") || "";
}