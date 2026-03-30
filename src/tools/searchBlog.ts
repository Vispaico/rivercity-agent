import { supabase } from "../lib/supabase";

export async function searchBlog(query: string) {
  const { data } = await supabase
    .from("posts")
    .select("title, slug, content")
    .eq("is_published", true)
    .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
    .limit(3);

  if (!data || data.length === 0) {
    return "NO_BLOG_FOUND";
  }

  return `
### BLOG RESULTS
${data
  .map(
    (p: any) => `
Title: ${p.title}
URL: https://www.rivercitybikerentals.com/blog/${p.slug}
Content: ${stripHtml(p.content).slice(0, 1000)}
`
  )
  .join("\n")}
### END BLOG
`;
}

// quick HTML stripper (important)
function stripHtml(html: string) {
  return html.replace(/<[^>]*>?/gm, "");
}