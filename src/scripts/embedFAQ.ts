// src/scripts/embedFAQ.ts
import "dotenv/config";
import { supabase } from "../lib/supabase.js";
import { embed } from "../lib/embed.js";
import faqData from "../data/faqData.json";

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
      const content = item.fullAnswer;
      const vector = await embed(content);

      // 2️⃣ insert into Supabase
      const { error } = await supabase.from("documents").insert([
        {
          slug: item.slug,
          question: item.question,
          title: item.metaTitle,
          shortSnippet: item.shortSnippet,
          fullAnswer: item.fullAnswer,
          content,
          source: "faq",
          vector,
          metadata: {
            id: item.id,
            metaTitle: item.metaTitle,
            metaDescription: item.metaDescription,
          },
        },
      ]);

      if (error) {
        console.error("Supabase insert error:", error);
      } else {
        console.log(`✅ Embedded & stored: ${item.slug}`);
      }
    } catch (err) {
      console.error("Error embedding item:", item.slug, err);
    }
  }
}

// Run it
embedAndStore(faqData);