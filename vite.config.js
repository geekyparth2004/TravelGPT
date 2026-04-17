import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { searchHotels } from './liveSearch.mjs';

const hotelApiPlugin = () => ({
  name: 'travelgpt-hotel-api',
  configureServer(server) {
    server.middlewares.use('/api/hotels/search', async (req, res) => {
      try {
        const requestUrl = new URL(req.url || '', 'http://localhost');
        const payload = await searchHotels(Object.fromEntries(requestUrl.searchParams.entries()));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Live hotel search failed.'
          })
        );
      }
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/hotels/search', async (req, res) => {
      try {
        const requestUrl = new URL(req.url || '', 'http://localhost');
        const payload = await searchHotels(Object.fromEntries(requestUrl.searchParams.entries()));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      } catch (error) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : 'Live hotel search failed.'
          })
        );
      }
    });
  }
});

export default defineConfig({
  plugins: [react(), hotelApiPlugin()]
});
