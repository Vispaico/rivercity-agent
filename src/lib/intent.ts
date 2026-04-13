export function detectIntent(query: string) {
  const q = query.toLowerCase();

  if (
    q.includes("price") ||
    q.includes("rent") ||
    q.includes("book") ||
    q.includes("cost") ||
    q.includes("precio") ||
    q.includes("alquilar") ||
    q.includes("reserva") ||
    q.includes("thuê") ||
    q.includes("đặt") ||
    q.includes("giá")
  ) return "business";

  if (
    q.includes("how") ||
    q.includes("guide") ||
    q.includes("travel") ||
    q.includes("route") ||
    q.includes("cómo") ||
    q.includes("guía") ||
    q.includes("viaje") ||
    q.includes("đi") ||
    q.includes("hướng dẫn")
  ) return "travel";

  return "general";
}