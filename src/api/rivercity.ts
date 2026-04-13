import type { VercelRequest, VercelResponse } from '@vercel/node';
import { askAgent } from '../agent/agent.js';
import { checkRateLimit } from '../lib/rateLimit.js';

const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 30);
const MAX_MESSAGE_CHARS = Number(process.env.MAX_MESSAGE_CHARS ?? 1200);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required' });
  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Message must be a string' });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return res.status(413).json({ error: 'Message too long' });
  }

  const clientKey = buildClientKey(req, sessionId);
  const rateLimit = await checkRateLimit(
    clientKey,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX
  );
  if (!rateLimit.allowed) {
    return res.status(429).json({
      error: 'Rate limit exceeded. Please retry.',
      resetAt: rateLimit.resetAt,
      remaining: rateLimit.remaining,
    });
  }

  try {
    const response = await askAgent(message, sessionId ?? "default");
    res.status(200).json({ response });
  } catch (err: any) {
    console.error('Agent API error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
}

function buildClientKey(req: VercelRequest, sessionId?: string) {
  const forwarded = String(req.headers['x-forwarded-for'] ?? '')
    .split(',')[0]
    .trim();
  const ip = forwarded || req.socket.remoteAddress || 'unknown';
  return `${sessionId ?? 'default'}:${ip}`;
}

