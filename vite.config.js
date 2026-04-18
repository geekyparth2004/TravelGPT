import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { searchHotels, getHotelDetails } from './liveSearch.mjs';

// Load .env so OPENAI_API_KEY is available in Vite plugin middleware
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  for (const line of readFileSync(join(__dir, '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch { /* .env absent — env vars set externally */ }

const sendJson = (res, status, data) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
};

const attachApiRoutes = (middlewares) => {
  middlewares.use('/api/hotels/search', async (req, res) => {
    try {
      const { searchParams } = new URL(req.url || '', 'http://localhost');
      const payload = await searchHotels(Object.fromEntries(searchParams.entries()));
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'Hotel search failed.' });
    }
  });

  middlewares.use('/api/hotels/info', async (req, res) => {
    try {
      const { searchParams } = new URL(req.url || '', 'http://localhost');
      const p = Object.fromEntries(searchParams.entries());
      const info = await getHotelDetails({
        name: p.name,
        area: p.area,
        destination: p.destination,
        checkIn: p.checkIn,
        checkOut: p.checkOut,
        guests: Number(p.guests) || 2,
        budget: p.budget ? Number(p.budget) : null,
        nights: Number(p.nights) || 1
      });
      sendJson(res, 200, { info });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'Hotel info failed.' });
    }
  });
};

const hotelApiPlugin = () => ({
  name: 'travelgpt-hotel-api',
  configureServer(server) { attachApiRoutes(server.middlewares); },
  configurePreviewServer(server) { attachApiRoutes(server.middlewares); }
});

export default defineConfig({
  plugins: [react(), hotelApiPlugin()]
});
