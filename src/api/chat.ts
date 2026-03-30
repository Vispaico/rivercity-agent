import { runAgent } from "../agent/agent";

export async function chat(message: string) {
  return await runAgent(message);
}