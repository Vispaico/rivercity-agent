// src/lib/embedAndStore.ts
import { supabase } from './supabase.js'
import { embed } from './embed.js'

interface EmbedItem {
  content: string
  metadata?: Record<string, any>
}

export async function embedAndStore(item: EmbedItem) {
  const vector = await embed(item.content)

  const { error } = await supabase.from('documents').insert([
    {
      content: item.content,
      vector,
      metadata: item.metadata || {},
    },
  ])

  if (error) {
    console.error('Supabase insert error:', error)
    throw error
  }

  console.log('✅ Inserted:', item.metadata?.slug || 'no slug')
}