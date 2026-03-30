// src/tools/searchKnowledge.ts
import OpenAI from 'openai'
import { supabase } from '../lib/supabase'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
})

// ✅ Type definition for document metadata
export interface Document {
  id: string            // use string to match agent types
  slug: string
  question: string
  metaTitle: string
  metaDescription: string
  shortSnippet: string
  fullAnswer: string
  [key: string]: any
}

// The main search function
export async function searchKnowledge(
  query: string,
  topK: number = 3
): Promise<Document[]> {
  try {
    // 1️⃣ Embed user query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query
    })
    const queryVector = embeddingResponse.data[0].embedding

    // 2️⃣ Call Supabase RPC for vector search
    const { data, error } = await supabase
      .rpc('match_documents', {
        query_vector: queryVector,
        top_k: topK
      })

    if (error) {
      console.error('Supabase search error:', error)
      return []
    }

    // 3️⃣ Ensure 'id' is string
    return (data as Document[]).map(doc => ({
      ...doc,
      id: String(doc.id)
    }))
  } catch (err) {
    console.error('searchKnowledge error:', err)
    return []
  }
}