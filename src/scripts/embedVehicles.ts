import "dotenv/config";
import { supabase } from "../lib/supabase.js";
import { embed } from "../lib/embed.js";

interface VehicleRow {
  id: string | number;
  name?: string | null;
  type?: string | null;
  brand?: string | null;
  model?: string | null;
  description?: string | null;
  price_per_day?: number | null;
  price_per_hour?: number | null;
  price_per_week?: number | null;
  price_per_month?: number | null;
  currency?: string | null;
  slug?: string | null;
  url?: string | null;
}

function buildVehicleContent(vehicle: VehicleRow) {
  const parts = [
    vehicle.name,
    vehicle.brand,
    vehicle.model,
    vehicle.type,
    vehicle.description,
    vehicle.price_per_hour ? `Price per hour: ${vehicle.price_per_hour}` : null,
    vehicle.price_per_day ? `Price per day: ${vehicle.price_per_day}` : null,
    vehicle.price_per_week ? `Price per week: ${vehicle.price_per_week}` : null,
    vehicle.price_per_month ? `Price per month: ${vehicle.price_per_month}` : null,
    vehicle.currency ? `Currency: ${vehicle.currency}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return parts;
}

async function run() {
  const { data: vehicles, error } = await supabase.from("vehicles").select("*");

  if (error) {
    console.error("Supabase vehicles fetch error:", error);
    return;
  }

  if (!vehicles || vehicles.length === 0) {
    console.log("No vehicles found.");
    return;
  }

  for (const vehicle of vehicles as VehicleRow[]) {
    const content = buildVehicleContent(vehicle);
    if (!content) continue;

    const vector = await embed(content);

    await supabase.from("documents").insert({
      slug: vehicle.slug ?? null,
      title: vehicle.name ?? null,
      content,
      fullAnswer: content,
      source: "vehicles",
      url: vehicle.url ?? null,
      metadata: {
        id: vehicle.id,
        type: vehicle.type,
        brand: vehicle.brand,
        model: vehicle.model,
      },
      vector,
    });

    console.log("✅ Embedded vehicle:", vehicle.name ?? vehicle.id);
  }
}

run();
