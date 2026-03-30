// src/scripts/embedFAQ.ts
import 'dotenv/config'           // ensure env vars are loaded
import { supabase } from '../lib/supabase'   // your Supabase client
import { embed } from '../lib/embed'         // your embed helper
import faqData from '../data/faqData.json'   // your copied JSON

interface FAQItem {
  id: number
  slug: string
  question: string
  metaTitle: string
  metaDescription: string
  shortSnippet: string
  fullAnswer: string
}

async function embedAndStore(items: FAQItem[]) {
  for (const item of items) {
    try {
      // 1️⃣ create embedding
      const vector = await embed(item.fullAnswer)

      // 2️⃣ insert into Supabase
      const { error } = await supabase.from('documents').insert([
        {
          content: item.fullAnswer,
          vector, // embedding vector
          metadata: {
            id: item.id,
            slug: item.slug,
            question: item.question,
            metaTitle: item.metaTitle,
            metaDescription: item.metaDescription,
          },
        },
      ])

      if (error) {
        console.error('Supabase insert error:', error)
      } else {
        console.log(`✅ Embedded & stored: ${item.slug}`)
      }
    } catch (err) {
      console.error('Error embedding item:', item.slug, err)
    }
  }
}

// Run it
embedAndStore(faqData)