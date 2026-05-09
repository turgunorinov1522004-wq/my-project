import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('\n  ERROR: ANTHROPIC_API_KEY is not set in .env\n');
  process.exit(1);
}

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '..'))); // serve the frontend

/* ── Text Generation (Claude, streamed) ──────────────────────── */
app.post('/api/text', async (req, res) => {
  const { prompt, tone = 'Professional', length = 'Medium (~300 words)', model = 'Claude Haiku 4.5' } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

  const modelMap = {
    'Claude Opus 4.7':   'claude-opus-4-7',
    'Claude Sonnet 4.6': 'claude-sonnet-4-6',
    'Claude Haiku 4.5':  'claude-haiku-4-5-20251001',
  };
  const resolvedModel = modelMap[model] ?? 'claude-haiku-4-5-20251001';

  const lengthGuide = {
    'Short (~100 words)':  'Write a short response of approximately 100 words.',
    'Medium (~300 words)': 'Write a medium-length response of approximately 300 words.',
    'Long (~800 words)':   'Write a detailed response of approximately 800 words.',
  };

  const system = `You are a skilled writer. Tone: ${tone}. ${lengthGuide[length] ?? ''}`;

  // Server-Sent Events so the browser sees tokens as they arrive
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = client.messages.stream({
      model: resolvedModel,
      max_tokens: 1500,
      system,
      messages: [{ role: 'user', content: prompt }],
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: event.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.end();
});

/* ── Image Generation (Pollinations.ai — free, no key needed) ── */
app.post('/api/image', async (req, res) => {
  const {
    prompt,
    negative = '',
    style = 'Photorealistic',
    size = '1024 × 1024',
  } = req.body;

  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });

  // Parse "1024 × 1024" or "1792 × 1024 (Wide)"
  const match = size.match(/(\d+)\s*[×x]\s*(\d+)/);
  const width  = match ? parseInt(match[1]) : 1024;
  const height = match ? parseInt(match[2]) : 1024;

  const fullPrompt = [prompt, `${style} style`, 'high quality, detailed']
    .filter(Boolean).join(', ');

  const params = new URLSearchParams({
    width:   String(width),
    height:  String(height),
    seed:    String(Math.floor(Math.random() * 999999)),
    nologo:  'true',
    enhance: 'true',
    ...(negative ? { negative } : {}),
  });

  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?${params}`;
  res.json({ url });
});

app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   GenHub server ready                ║
  ║   http://localhost:${PORT}               ║
  ╚══════════════════════════════════════╝
  `);
});
