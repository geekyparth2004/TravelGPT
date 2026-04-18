
import { searchHotels } from './liveSearch.mjs';

async function test() {
  try {
    const results = await searchHotels({
      destination: 'Goa',
      checkIn: '2026-05-10',
      checkOut: '2026-05-15',
      guests: '2',
      budget: '5000',
      amenities: 'wifi,pool'
    });
    console.log('Results:', JSON.stringify(results, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }
}

test();
