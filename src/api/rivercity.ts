import type { VercelRequest, VercelResponse } from '@vercel/node';
import { askAgent } from '../agent/agent.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });

  try {
    const response = await askAgent(message, sessionId ?? "default");
    res.status(200).json({ response });
  } catch (err: any) {
    console.error('Agent API error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}