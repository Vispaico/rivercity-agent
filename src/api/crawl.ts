import type { VercelRequest, VercelResponse } from "@vercel/node";
import { crawl } from "../scripts/crawl.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  try {
    await crawl("https://www.rivercitybikerentals.com");

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "crawl failed" });
  }
}