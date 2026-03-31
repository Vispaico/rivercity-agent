import "dotenv/config";
import { chromium, Browser } from "playwright";
import OpenAI from "openai";
import { supabase } from "../lib/supabase.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const BASE_URL = "https://www.rivercitybikerentals.com";
const visited = new Set<string>();

export async function crawl(url: string, browser: Browser, depth = 0) {
  if (visited.has(url) || depth > 2) return;
  visited.add(url);

  console.log("Crawling:", url);

  const page = await browser.newPage();

  // ✅ FAIL SAFE (no more crashes)
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
  } catch (err) {
    console.log("⚠️ Failed:", url);
    await page.close();
    return;
  }

  // ✅ CLEAN TEXT EXTRACTION
  const text = await page.evaluate(() => {
    document
      .querySelectorAll("script, style, nav, footer")
      .forEach((el) => el.remove());
    return document.body.innerText;
  });

  console.log("TEXT LENGTH:", text.length);

  if (text.length < 300) {
    await page.close();
    return;
  }

  const chunks = chunkText(text);

  for (const chunk of chunks) {
    const emb = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: chunk,
    });

    // ✅ SOURCE PRIORITY LOGIC
    const isProduct =
      url.includes("/motorbikes") || url.includes("/cars");

    await supabase.from("documents").insert({
      slug: url,
      question: chunk.slice(0, 80),
      fullAnswer: chunk,
      shortSnippet: chunk.slice(0, 120),
      source: isProduct ? "product" : "website",
      confidence: isProduct ? 0.95 : 0.8,
      vector: emb.data[0].embedding,
    });
  }

  // ✅ EXTRACT LINKS (typed → fixes TS error)
  const links = await page.$$eval(
    "a",
    (anchors: HTMLAnchorElement[]) => anchors.map((a) => a.href)
  );

  await page.close();

  for (const link of links) {
    if (!link) continue;

    // ✅ NORMALIZATION (remove ? and #)
    const cleanLink = link.split("#")[0].split("?")[0];

    // stay inside domain
    if (!cleanLink.startsWith(BASE_URL)) continue;

    // ❌ SKIP JUNK PAGES (VERY IMPORTANT)
    if (
      cleanLink.includes("/dashboard") ||
      cleanLink.includes("/signup") ||
      cleanLink.includes("/login")
    ) {
      continue;
    }

    // remove trailing slash
    const normalized =
      cleanLink.endsWith("/") && cleanLink !== BASE_URL
        ? cleanLink.slice(0, -1)
        : cleanLink;

    await crawl(normalized, browser, depth + 1);
  }
}

// ✅ CHUNKING
function chunkText(text: string, size = 500) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}

// ✅ LOCAL RUN
if (process.env.NODE_ENV !== "production") {
  (async () => {
    const browser = await chromium.launch();
    await crawl(BASE_URL, browser);
    await browser.close();
    console.log("✅ Crawl finished");
  })();
}