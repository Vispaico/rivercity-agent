import { openai } from "../lib/openai";
import { supabase } from "../lib/supabase";

function stripHtml(html: string) {
  return html.replace(/<[^>]*>?/gm, "");
}

function chunkText(text: string, size = 700) {
  const words = text.split(" ");
  const chunks = [];

  for (let i = 0; i < words.length; i += size) {
    chunks.push(words.slice(i, i + size).join(" "));
  }

  return chunks;
}

async function run() {
  const { data: posts } = await supabase
    .from("posts")
    .select("title, slug, content")
    .eq("is_published", true);

  if (!posts) return;

  for (const post of posts) {
    const clean = stripHtml(post.content);
    const chunks = chunkText(clean);

    for (const chunk of chunks) {
      const embedding = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: chunk,
      });

      await supabase.from("documents").insert({
        content: chunk,
        embedding: embedding.data[0].embedding,
        source: "blog",
        title: post.title,
        url: `https://www.rivercitybikerentals.com/blog/${post.slug}`,
      });

      console.log("✅ Embedded chunk:", post.title);
    }
  }
}

run();