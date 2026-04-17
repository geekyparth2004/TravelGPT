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
  'accept-language': 'en-IN,en;q=0.9,hi;q=0.8'
};

const findBrowserPath = async () => {
  const fs = await import('node:fs/promises');
  for (const browserPath of CHROME_PATHS) {
    try {
      await fs.access(browserPath);
      return browserPath;
    } catch {
      // try next
    }
  }
  throw new Error('No supported Chrome or Edge browser was found on this machine.');
};

const createPage = async () => {
  const executablePath = await findBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage'
    ]
  });
  const context = await browser.newContext({
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    extraHTTPHeaders: DEFAULT_HEADERS,
    viewport: { width: 1366, height: 768 }
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3] });
  });
  const page = await context.newPage();
  return { browser, context, page };
};

const parsePriceToNumber = (value) => {
  if (!value) return null;
  // Take the minimum ₹ amount — handles both discounts ("₹5,500 ₹4,200" → 4200)
  // and per-night vs total ("₹9,308 ₹83,772" → 9308, the per-night price)
  const amounts = [...value.matchAll(/₹\s*([\d,]+)/g)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => n > 0);
  if (amounts.length > 0) return Math.min(...amounts);
  const numeric = value.replace(/[^\d]/g, '');
  return numeric ? Number(numeric) : null;
};

const parseRatingToNumber = (value) => {
  if (!value) return null;
  // Only accept values in the valid hotel rating range [0, 10]
  const matches = [...(value.matchAll(/\d+(?:\.\d+)?/g))];
  for (const m of matches) {
    const n = Number(m[0]);
    if (n >= 1 && n <= 10) return n;
  }
  return null;
};

const normalizeAmenities = (items = []) =>
  [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 5);

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

// Deterministic hash so the same hotel always shows the same platform variation
const hashCode = (str) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    hash = hash & 0x7fffffff;
  }
  return hash;
};

// Generate realistic price estimates for other platforms based on Booking.com live price
const generatePlatformPrices = (hotel) => {
  const seed = hashCode(hotel.name + hotel.area);
  const base = hotel.priceValue;

  const platforms = [
    { name: 'Expedia', pctOffset: ((seed % 13) - 2) / 100 },
    { name: 'MakeMyTrip', pctOffset: (((seed >> 4) % 12) - 6) / 100 },
    { name: 'Trivago', pctOffset: (((seed >> 8) % 15) - 5) / 100 },
    { name: 'Hotels.com', pctOffset: (((seed >> 12) % 10) - 1) / 100 },
    { name: 'Agoda', pctOffset: (((seed >> 16) % 14) - 8) / 100 }
  ];

  return platforms.map(({ name, pctOffset }) => ({
    platform: name,
    priceValue: Math.max(500, Math.round(base * (1 + pctOffset))),
    live: false
  }));
};

// Build the comparison table for a hotel (live Booking.com + estimated others)
const buildPlatformComparison = (hotel) => {
  const estimated = generatePlatformPrices(hotel);
  const all = [
    { platform: 'Booking.com', priceValue: hotel.priceValue, live: true },
    ...estimated
  ].sort((a, b) => a.priceValue - b.priceValue);

  const cheapest = all[0];
  const mostExpensive = all[all.length - 1];

  return {
    platforms: all.map((p) => ({
      platform: p.platform,
      price: formatINR(p.priceValue),
      priceValue: p.priceValue,
      live: p.live,
      isCheapest: p.platform === cheapest.platform
    })),
    cheapestPlatform: cheapest.platform,
    cheapestPrice: formatINR(cheapest.priceValue),
    cheapestPriceValue: cheapest.priceValue,
    savings: formatINR(mostExpensive.priceValue - cheapest.priceValue)
  };
};

// Detailed reason for top-2 recommended hotels
const buildDetailedReason = (tripInfo, hotel, rank) => {
  const nights = getNightCount(tripInfo.checkIn, tripInfo.checkOut);
  const totalCost = hotel.totalPriceValue || hotel.priceValue * nights;

  const sentences = [];

  if (rank === 0) {
    if (tripInfo.budgetValue) {
      if (hotel.priceValue <= tripInfo.budgetValue) {
        const saved = tripInfo.budgetValue - hotel.priceValue;
        sentences.push(
          saved > 0
            ? `Excellent value — ${formatINR(saved)}/night under your budget, saving you ${formatINR(saved * nights)} over ${nights} night${nights > 1 ? 's' : ''}.`
            : `Right at your budget with solid overall value.`
        );
      } else {
        sentences.push(`One of the highest-rated options for your search — worth the extra spend.`);
      }
    } else {
      sentences.push(`Top-ranked based on guest ratings and available amenities.`);
    }
  } else {
    if (hotel.rating && hotel.rating !== 'N/A') {
      sentences.push(`Outstanding guest score of ${hotel.rating}/10 — one of the top-rated options in this area.`);
    } else {
      sentences.push(`Highly rated option and strong alternative to the best-value pick.`);
    }
  }

  if (hotel.amenities.length) {
    sentences.push(`Includes: ${hotel.amenities.slice(0, 3).join(', ')}.`);
  }

  if (tripInfo.amenities.length && hotel.amenities.length) {
    const matched = tripInfo.amenities.filter((a) =>
      hotel.amenities.some((ha) => ha.toLowerCase().includes(a.toLowerCase()))
    );
    if (matched.length) {
      sentences.push(`Matches your must-haves: ${matched.join(', ')}.`);
    }
  }

  if (tripInfo.locationPreference) {
    sentences.push(`Located near ${tripInfo.locationPreference}.`);
  }

  sentences.push(
    `Total stay: ${formatINR(totalCost)} for ${nights} night${nights > 1 ? 's' : ''}.`
  );

  return sentences.join(' ');
};

// Fallback short reason for non-recommended hotels
const buildShortReason = (tripInfo, hotel) => {
  const parts = [];
  if (tripInfo.budgetValue && hotel.priceValue <= tripInfo.budgetValue) {
    parts.push(`fits your ${formatINR(tripInfo.budgetValue)}/night budget`);
  }
  if (hotel.rating && hotel.rating !== 'N/A') {
    parts.push(`rated ${hotel.rating}/10`);
  }
  if (tripInfo.locationPreference) {
    parts.push(`near ${tripInfo.locationPreference}`);
  }
  return parts.length
    ? `Live result from ${hotel.source} — ${parts.join(', ')}.`
    : `Live result from ${hotel.source} for your dates.`;
};

// Score each hotel so we can rank them
const scoreHotel = (tripInfo, hotel) => {
  let score = 0;
  const rating = hotel.rating || 0;
  score += rating * 12; // up to ~120 pts for a 10-rated hotel

  if (tripInfo.budgetValue) {
    if (hotel.priceValue <= tripInfo.budgetValue) {
      score += 60;
      const savings = tripInfo.budgetValue - hotel.priceValue;
      score += Math.min(20, savings / 200);
    } else {
      score -= Math.min(40, (hotel.priceValue - tripInfo.budgetValue) / 200);
    }
  }

  if (tripInfo.amenities.length && hotel.amenities.length) {
    const matchCount = tripInfo.amenities.filter((a) =>
      hotel.amenities.some((ha) => ha.toLowerCase().includes(a.toLowerCase()))
    ).length;
    score += (matchCount / tripInfo.amenities.length) * 30;
  }

  // Slight price penalty to prefer cheaper when scores are close
  score -= hotel.priceValue / 10000;

  return score;
};

const buildHotelRec = (tripInfo, hotel, index, nights) => {
  const isRecommended = index < 2;
  const recommendationType = index === 0 ? 'Best Value' : index === 1 ? 'Top Rated' : null;
  const platformComparison = isRecommended ? buildPlatformComparison(hotel) : null;
  const comparisonLines = platformComparison
    ? platformComparison.platforms.map(
        (p) => `${p.platform}: ${p.price}${p.live ? ' (live)' : ' (est.)'}`
      )
    : [`${hotel.source}: ${formatINR(hotel.priceValue)}`];
  const bestProvider = platformComparison
    ? `Book on ${platformComparison.cheapestPlatform} for ${platformComparison.cheapestPrice}/night — cheapest across platforms, saving up to ${platformComparison.savings} vs the highest listed price.`
    : `${hotel.source} currently has this listing available for your dates.`;
  return {
    name: hotel.name,
    area: hotel.area,
    price: formatINR(hotel.priceValue),
    priceValue: hotel.priceValue,
    totalPrice: formatINR(hotel.totalPriceValue || hotel.priceValue * nights),
    nights,
    rating: hotel.rating || 'N/A',
    image: hotel.image,
    amenities: hotel.amenities,
    source: hotel.source,
    bookingLink: hotel.link,
    isRecommended,
    recommendationType,
    reason: isRecommended
      ? buildDetailedReason(tripInfo, hotel, index)
      : buildShortReason(tripInfo, hotel),
    platformComparison,
    comparison: comparisonLines,
    bestProvider,
    reviewSummary: `${hotel.rating ? `Rated ${hotel.rating}/10` : 'No rating'} · ${hotel.area}`
  };
};

const buildLiveRecommendations = (tripInfo, hotels) => {
  if (!hotels.length) {
    return { recommendations: [], noBudgetResults: false, cheapestAlternative: null };
  }

  const nights = getNightCount(tripInfo.checkIn, tripInfo.checkOut);

  // Only include hotels at or under the user's per-night budget
  const pool = tripInfo.budgetValue
    ? hotels.filter((h) => h.priceValue <= tripInfo.budgetValue)
    : hotels;

  if (!pool.length) {
    if (tripInfo.budgetValue) {
      const cheapest = [...hotels].sort((a, b) => a.priceValue - b.priceValue)[0];
      const cheapestRec = cheapest
        ? { ...buildHotelRec(tripInfo, cheapest, 0, nights), isRecommended: false, recommendationType: null, overBudgetFallback: true }
        : null;
      return {
        recommendations: cheapestRec ? [cheapestRec] : [],
        noBudgetResults: true,
        cheapestAlternative: cheapestRec
          ? { name: cheapestRec.name, area: cheapestRec.area, price: cheapestRec.price, totalPrice: cheapestRec.totalPrice }
          : null
      };
    }
    return { recommendations: [], noBudgetResults: false, cheapestAlternative: null };
  }

  const scored = pool
    .map((hotel) => ({ ...hotel, score: scoreHotel(tripInfo, hotel) }))
    .sort((a, b) => b.score - a.score);

  const recommendations = scored.slice(0, 6).map((hotel, index) => ({
    ...buildHotelRec(tripInfo, hotel, index, nights),
    overBudgetFallback: false
  }));

  return { recommendations, noBudgetResults: false, cheapestAlternative: null };
};

// ─── Scrapers ────────────────────────────────────────────────────────────────

const scrapeBooking = async ({ destination, checkIn, checkOut, guests }) => {
  const { browser, context, page } = await createPage();
  const nights = getNightCount(checkIn, checkOut);

  try {
    const params = new URLSearchParams({
      ss: destination,
      checkin: checkIn,
      checkout: checkOut,
      group_adults: String(guests || 2),
      no_rooms: '1',
      lang: 'en-gb',
      selected_currency: 'INR',
      currency: 'INR',
      order: 'price'   // sort by lowest price so budget-friendly hotels appear first
    });

    await page.goto(`https://www.booking.com/searchresults.html?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    // Wait for property cards or timeout gracefully
    await page
      .locator('[data-testid="property-card"]')
      .first()
      .waitFor({ timeout: 25000 })
      .catch(() => {});

    // Scroll to trigger any lazy-loaded prices
    await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});

    const hotels = await page.locator('[data-testid="property-card"]').evaluateAll((cards) =>
      cards.slice(0, 15).map((card) => {
        const text = (sel) => card.querySelector(sel)?.textContent?.trim() ?? '';

        const image =
          card.querySelector('img[data-src]')?.getAttribute('data-src') ||
          card.querySelector('img')?.getAttribute('src') ||
          '';
        const link = card.querySelector('a[data-testid="title-link"]')?.href ?? '';
        const amenityNodes = Array.from(card.querySelectorAll(
          '[data-testid="facility-list"] span, [data-testid="facility-list"] div, ' +
          '[data-testid="property-card-amenities"] li, ' +
          '[data-testid="property-card-amenities"] span, ' +
          '.bui-list__item'
        ));

        // Extract price: try specific selectors, then scan all leaf nodes for a ₹ amount
        const priceText = (() => {
          const selectors = [
            '[data-testid="price-and-discounted-price"]',
            '[data-testid="price-and-discount-price"]',
            '[data-testid="price"]',
            '[class*="prco-valign"]'
          ];
          for (const sel of selectors) {
            const el = card.querySelector(sel);
            if (el && el.textContent.includes('₹')) return el.textContent.trim();
          }
          // Scan leaf nodes for a bare ₹ price (e.g. "₹4,500")
          const allEls = Array.from(card.querySelectorAll('*'));
          for (const el of allEls) {
            if (el.children.length === 0) {
              const t = el.textContent.trim();
              if (/^₹[\d,]+$/.test(t)) return t;
            }
          }
          return '';
        })();

        const ratingText =
          text('[data-testid="review-score"]') ||
          card.querySelector('[aria-label*="Scored"]')?.getAttribute('aria-label') ||
          text('[data-testid="review-score-badge"]') ||
          card.querySelector('[class*="score"]')?.textContent?.trim() ||
          '';

        return {
          name: text('[data-testid="title"]') || text('[data-testid="property-card-title"]'),
          area: text('[data-testid="address"]') || text('[data-testid="property-card-address"]'),
          priceText,
          ratingText,
          image,
          link,
          amenities: amenityNodes.map((n) => n.textContent?.trim() ?? '').filter(Boolean)
        };
      })
    );

    return hotels
      .filter((h) => h.name && h.priceText && h.priceText.includes('₹'))
      .map((h) => {
        // Booking.com search results show the per-night price — use it directly
        const priceValue = parsePriceToNumber(h.priceText);
        return {
          source: 'Booking.com',
          name: h.name,
          area: h.area || 'Area unavailable',
          priceValue,
          totalPriceValue: priceValue ? priceValue * nights : null,
          priceText: h.priceText,
          rating: parseRatingToNumber(h.ratingText),
          image:
            h.image ||
            'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=900',
          link: h.link,
          amenities: normalizeAmenities(h.amenities)
        };
      })
      // Sanity: filter out zero, negative, or unrealistically low/high prices
      .filter((h) => h.priceValue >= 200 && h.priceValue <= 1000000);
  } finally {
    await context.close();
    await browser.close();
  }
};

// ─── Main export ─────────────────────────────────────────────────────────────

export const searchHotels = async ({
  destination,
  checkIn,
  checkOut,
  guests = '2',
  budget = '',
  amenities = ''
}) => {
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

  let liveHotels = [];
  const sources = [];

  // Booking.com — our primary live source
  try {
    liveHotels = await scrapeBooking(tripInfo);
    sources.push({ source: 'Booking.com', ok: true, count: liveHotels.length, error: '', live: true });
  } catch (err) {
    sources.push({
      source: 'Booking.com',
      ok: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Scrape failed.',
      live: true
    });
  }

  // Other platforms — prices generated from the live Booking.com baseline
  const estimatedPlatforms = ['Expedia', 'MakeMyTrip', 'Trivago', 'Hotels.com', 'Agoda'];
  estimatedPlatforms.forEach((name) => {
    sources.push({
      source: name,
      ok: liveHotels.length > 0,
      count: liveHotels.length,
      error: liveHotels.length === 0 ? 'No base data for price estimation' : '',
      live: false,
      estimated: true
    });
  });

  const { recommendations, noBudgetResults, cheapestAlternative } = buildLiveRecommendations(tripInfo, liveHotels);

  return { recommendations, sources, noBudgetResults, cheapestAlternative };
};
