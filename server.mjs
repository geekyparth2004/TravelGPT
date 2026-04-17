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
import { searchHotels } from './liveSearch.mjs';

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

app.listen(PORT, () => {
  console.log(`TravelGPT API running on http://localhost:${PORT}`);
});
