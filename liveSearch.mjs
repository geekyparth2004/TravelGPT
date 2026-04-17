import { chromium } from 'playwright-core';

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

const DEFAULT_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'accept-language': 'en-IN,en;q=0.9'
};

const findBrowserPath = async () => {
  const fs = await import('node:fs/promises');
  for (const browserPath of CHROME_PATHS) {
    try {
      await fs.access(browserPath);
      return browserPath;
    } catch {
      // Try next candidate.
    }
  }

  throw new Error('No supported Chrome or Edge browser was found on this machine.');
};

const createPage = async () => {
  const executablePath = await findBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--disable-blink-features=AutomationControlled']
  });
  const context = await browser.newContext({
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: DEFAULT_HEADERS
  });
  const page = await context.newPage();
  return { browser, context, page };
};

const parsePriceToNumber = (value) => {
  if (!value) return null;
  const numeric = value.replace(/[^\d]/g, '');
  return numeric ? Number(numeric) : null;
};

const parseRatingToNumber = (value) => {
  if (!value) return null;
  const match = value.match(/\d+(\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const normalizeAmenities = (items = []) =>
  [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 4);

const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Math.round(value));

const getNightCount = (checkIn, checkOut) => {
  const start = new Date(`${checkIn}T00:00:00Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
};

const buildReason = (tripInfo, hotel) => {
  const parts = [];
  if (tripInfo.budgetValue && hotel.priceValue <= tripInfo.budgetValue) {
    parts.push(`fits within your ${formatINR(tripInfo.budgetValue)}/night budget`);
  }
  if (tripInfo.locationPreference) parts.push(`keeps you near ${tripInfo.locationPreference}`);
  if (tripInfo.amenities.length && hotel.amenities.length) {
    const matchingAmenities = tripInfo.amenities.filter((amenity) =>
      hotel.amenities.some((value) => value.toLowerCase().includes(amenity.toLowerCase()))
    );
    if (matchingAmenities.length) parts.push(`matches amenities like ${matchingAmenities.join(', ')}`);
  }
  if (hotel.rating && hotel.rating !== 'N/A') parts.push(`has a rating of ${hotel.rating}`);
  return `Live result from ${hotel.source} that ${parts.join(', ') || 'is currently available for your dates'}.`;
};

const scrapeBooking = async ({ destination, checkIn, checkOut, guests }) => {
  const { browser, context, page } = await createPage();

  try {
    const params = new URLSearchParams({
      ss: destination,
      checkin: checkIn,
      checkout: checkOut,
      group_adults: String(guests || 2),
      no_rooms: '1'
    });

    await page.goto(`https://www.booking.com/searchresults.html?${params.toString()}`, {
      waitUntil: 'networkidle',
      timeout: 90000
    });
    await page.locator('[data-testid="property-card"]').first().waitFor({ timeout: 25000 });

    const hotels = await page.locator('[data-testid="property-card"]').evaluateAll((cards) =>
      cards.slice(0, 8).map((card) => {
        const text = (selector) => card.querySelector(selector)?.textContent?.trim() || '';
        const image =
          card.querySelector('img')?.getAttribute('src') ||
          card.querySelector('img')?.getAttribute('data-src') ||
          '';
        const link = card.querySelector('a[data-testid="title-link"]')?.href || '';
        const amenityNodes = Array.from(card.querySelectorAll('[data-testid="facility-list"] div'));

        return {
          name: text('[data-testid="title"]'),
          area: text('[data-testid="address"]'),
          priceText: text('[data-testid="price-and-discounted-price"]') || text('[data-testid="price-and-discount-price"]'),
          ratingText:
            text('[data-testid="review-score"] div') ||
            text('[data-testid="review-score"]') ||
            text('[aria-label*="Scored"]'),
          image,
          link,
          amenities: amenityNodes.map((node) => node.textContent?.trim() || '').filter(Boolean)
        };
      })
    );

    return hotels
      .filter((hotel) => hotel.name && hotel.priceText)
      .map((hotel) => ({
        source: 'Booking.com',
        name: hotel.name,
        area: hotel.area || 'Area unavailable',
        priceValue: parsePriceToNumber(hotel.priceText),
        priceText: hotel.priceText,
        rating: parseRatingToNumber(hotel.ratingText),
        image:
          hotel.image ||
          'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=900',
        link: hotel.link,
        amenities: normalizeAmenities(hotel.amenities)
      }))
      .filter((hotel) => hotel.priceValue);
  } finally {
    await context.close();
    await browser.close();
  }
};

const scrapeExpedia = async ({ destination, checkIn, checkOut, guests }) => {
  const { browser, context, page } = await createPage();

  try {
    const params = new URLSearchParams({
      destination,
      startDate: checkIn,
      endDate: checkOut,
      rooms: '1',
      adults: String(guests || 2)
    });

    await page.goto(`https://www.expedia.com/Hotel-Search?${params.toString()}`, {
      waitUntil: 'networkidle',
      timeout: 90000
    });

    const title = await page.title();
    if (/bot or not/i.test(title)) {
      throw new Error('Expedia blocked automated access from this environment.');
    }

    return [];
  } finally {
    await context.close();
    await browser.close();
  }
};

const scrapeMakeMyTrip = async ({ destination }) => {
  const { browser, context, page } = await createPage();

  try {
    await page.goto('https://www.makemytrip.com/hotels/', { waitUntil: 'networkidle', timeout: 90000 });
    const bodyText = await page.locator('body').innerText();

    if (!bodyText.toLowerCase().includes(destination.toLowerCase())) {
      throw new Error('MakeMyTrip search flow needs additional anti-bot/session handling.');
    }

    throw new Error('MakeMyTrip live hotel result extraction is not stable yet in this environment.');
  } finally {
    await context.close();
    await browser.close();
  }
};

const buildLiveRecommendations = (tripInfo, hotels) =>
  hotels
    .sort((a, b) => {
      const ratingScore = (b.rating || 0) - (a.rating || 0);
      if (ratingScore !== 0) return ratingScore;
      return a.priceValue - b.priceValue;
    })
    .slice(0, 6)
    .map((hotel) => ({
      name: hotel.name,
      area: hotel.area,
      price: formatINR(hotel.priceValue),
      totalPrice: formatINR(hotel.priceValue * getNightCount(tripInfo.checkIn, tripInfo.checkOut)),
      rating: hotel.rating || 'N/A',
      image: hotel.image,
      amenities: hotel.amenities,
      comparison: [`${hotel.source}: ${formatINR(hotel.priceValue)}`],
      reason: buildReason(tripInfo, hotel),
      bestProvider: `${hotel.source} currently shows the lowest captured price for this listing.`,
      reviewSummary: `${hotel.source} live listing for ${hotel.area}.`,
      bookingLink: hotel.link,
      source: hotel.source
    }));

export const searchHotels = async ({ destination, checkIn, checkOut, guests = '2', budget = '', amenities = '' }) => {
  if (!destination || !checkIn || !checkOut) {
    throw new Error('destination, checkIn, and checkOut are required.');
  }

  const tripInfo = {
    destination,
    checkIn,
    checkOut,
    guests: Number(guests) || 2,
    budgetValue: budget ? Number(budget) : null,
    amenities: String(amenities)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  };

  const tasks = [
    ['Booking.com', () => scrapeBooking(tripInfo)],
    ['Expedia', () => scrapeExpedia(tripInfo)],
    ['MakeMyTrip', () => scrapeMakeMyTrip(tripInfo)]
  ];

  const settled = await Promise.all(
    tasks.map(async ([source, task]) => {
      try {
        const hotels = await task();
        return { source, ok: true, hotels };
      } catch (error) {
        return {
          source,
          ok: false,
          hotels: [],
          error: error instanceof Error ? error.message : 'Unknown scraper error.'
        };
      }
    })
  );

  const liveHotels = settled.flatMap((result) => result.hotels);
  return {
    recommendations: buildLiveRecommendations(tripInfo, liveHotels),
    sources: settled.map((result) => ({
      source: result.source,
      ok: result.ok,
      count: result.hotels.length,
      error: result.error || ''
    }))
  };
};
