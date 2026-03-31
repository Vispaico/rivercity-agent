export function detectIntent(query: string) {
  const q = query.toLowerCase();

  if (
    q.includes("price") ||
    q.includes("rent") ||
    q.includes("book") ||
    q.includes("cost")
  ) return "business";

  if (
    q.includes("how") ||
    q.includes("guide") ||
    q.includes("travel") ||
    q.includes("route")
  ) return "travel";

  return "general";
}