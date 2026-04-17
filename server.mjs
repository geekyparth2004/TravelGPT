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
