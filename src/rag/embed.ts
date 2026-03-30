import { openai } from "../lib/openai.js";
import { supabase } from "../lib/supabase.js";

const content = `
RiverCity Rentals - Haiphong, Vietnam

Location:
RiverCity Rentals is located in Haiphong, Vietnam.
RiverCity Rentals nằm ở Hải Phòng, Việt Nam.

Services:
We rent motorbikes and cars.
We offer motorbike rentals (hourly and daily).
We offer car rentals (hourly and daily).
We also provide eSIM services for travelers.

Dịch vụ:
Chúng tôi cho thuê xe máy và ô tô.
Chúng tôi cung cấp dịch vụ cho thuê xe máy (theo giờ và theo ngày).
Chúng tôi cung cấp dịch vụ cho thuê ô tô (theo giờ và theo ngày).
Chúng tôi cung cấp eSIM cho du khách.

Restrictions:
We do NOT rent bicycles.
Chúng tôi KHÔNG cho thuê xe đạp.
`;

async function run() {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: content,
  });

  await supabase.from("knowledge").insert({
    content,
    embedding: embedding.data[0].embedding,
  });

  console.log("✅ Embedded");
}

run();