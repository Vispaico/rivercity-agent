import { runAgent } from "../agent/agent.js";

export async function chat(message: string) {
  return await runAgent(message);
}