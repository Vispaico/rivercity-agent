import { openai } from "../lib/openai";
import { buildSystemPrompt } from "../prompts/system";
import { searchKnowledge } from "../tools/searchKnowledge";
import { Document } from "../types/document";

export async function runAgent(message: string) {
  const system = buildSystemPrompt();

  // 1️⃣ Ask GPT if a tool call is needed
  const response = await openai.responses.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    tools: [
      {
        type: "function",
        name: "searchKnowledge",
        description: "Search internal knowledge about RiverCity Bike Rentals",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
        strict: true,
      },
    ],
    input: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
  });

  // 2️⃣ Check if GPT requested a tool call
  const functionCall = response.output.find(
    (item) => item.type === "function_call"
  );

  if (functionCall && functionCall.name === "searchKnowledge") {
    const args = JSON.parse(functionCall.arguments);

    // 3️⃣ Run internal search
    const results: Document[] = await searchKnowledge(args.query);

    // 4️⃣ Map search results to OpenAI function output format
    const functionCallOutput = results.map((doc) => ({
      type: "input_text" as const, // TS literal type
      text: doc.fullAnswer,
    }));

    // 5️⃣ Return final response with tool output
    const finalResponse = await openai.responses.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      input: [
        { role: "system", content: system },
        { role: "user", content: message },
        functionCall,
        {
          type: "function_call_output",
          call_id: functionCall.call_id,
          output: functionCallOutput,
        },
      ],
    });

    return finalResponse.output_text;
  }

  // 6️⃣ Otherwise just return GPT’s direct response
  return response.output_text;
}