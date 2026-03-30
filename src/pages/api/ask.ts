// src/pages/api/ask.ts
import type { NextApiRequest, NextApiResponse } from 'next'
import { runAgent } from '../../agent/agent.js'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { question } = req.body

  if (!question || typeof question !== 'string') {
    return res.status(400).json({ error: 'Missing question' })
  }

  try {
    const answer = await runAgent(question)
    res.status(200).json({ answer })
  } catch (err) {
    console.error('API error:', err)
    res.status(500).json({ error: 'Failed to get answer' })
  }
}