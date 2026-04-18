import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env file (simple parser, no dotenv dependency needed)
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envContent = readFileSync(join(__dir, '.env'), 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  // .env not present — env vars must be set in the shell
}

import cors from 'cors';
import express from 'express';
import { searchHotels, getHotelDetails } from './liveSearch.mjs';

const app = express();
const PORT = process.env.PORT || 8787;

app.use(cors());

app.get('/api/hotels/search', async (req, res) => {
  try {
    const payload = await searchHotels(req.query);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Live hotel search failed.'
    });
  }
});

app.get('/api/hotels/info', async (req, res) => {
  try {
    const { name, area, destination, checkIn, checkOut, guests, budget, nights } = req.query;
    const info = await getHotelDetails({
      name,
      area,
      destination,
      checkIn,
      checkOut,
      guests: Number(guests) || 2,
      budget: budget ? Number(budget) : null,
      nights: Number(nights) || 1
    });
    res.json({ info });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to get hotel details.' });
  }
});

// Quick test: verify OpenAI key is loaded
app.get('/api/status', (req, res) => {
  const key = process.env.OPENAI_API_KEY;
  res.json({
    openaiKey: key ? `${key.slice(0, 10)}...${key.slice(-4)} (${key.length} chars)` : 'MISSING',
    status: 'ok'
  });
});

app.listen(PORT, () => {
  const key = process.env.OPENAI_API_KEY;
  console.log(`TravelGPT API running on http://localhost:${PORT}`);
  console.log(`OpenAI key: ${key ? key.slice(0, 14) + '...' : 'NOT SET'}`);
});
