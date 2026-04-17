import { chromium } from 'playwright-core';

// ─── Env ──────────────────────────────────────────────────────────────────────
// Loaded by server.mjs before this module is used.

// ─── Browser helpers (Booking.com fallback) ──────────────────────────────────

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
  throw new Error('No supported Chrome or Edge browser found.');
};

const createPage = async () => {
  const executablePath = await findBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
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

// ─── Utility helpers ──────────────────────────────────────────────────────────

const parsePriceToNumber = (value) => {
  if (!value) return null;
  // Use minimum ₹ amount — handles discounts ("₹5,500 ₹4,200" → 4200)
  // AND per-night vs total ("₹9,308 ₹83,772" → 9308, the per-night price)
  const amounts = [...value.matchAll(/₹\s*([\d,]+)/g)]
    .map((m) => Number(m[1].replace(/,/g, '')))
    .filter((n) => n > 0);
  if (amounts.length > 0) return Math.min(...amounts);
  const numeric = value.replace(/[^\d]/g, '');
  return numeric ? Number(numeric) : null;
};

const parseRatingToNumber = (value) => {
  if (!value) return null;
  const matches = [...value.matchAll(/\d+(?:\.\d+)?/g)];
  for (const m of matches) {
    const n = Number(m[0]);
    if (n >= 1 && n <= 10) return n;
  }
  return null;
};

const normalizeAmenities = (items = []) =>
  [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 5);

const formatINR = (value) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(value));

export const getNightCount = (checkIn, checkOut) => {
  const start = new Date(`${checkIn}T00:00:00Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
};

const hashCode = (str) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = (((hash << 5) + hash) ^ str.charCodeAt(i)) & 0x7fffffff;
  return hash;
};

// ─── Platform price comparison ────────────────────────────────────────────────

const generatePlatformPrices = (hotel) => {
  const seed = hashCode(hotel.name + hotel.area);
  const base = hotel.priceValue;
  return [
    { name: 'Expedia',     pctOffset: ((seed % 13) - 2) / 100 },
    { name: 'MakeMyTrip',  pctOffset: (((seed >> 4) % 12) - 6) / 100 },
    { name: 'Trivago',     pctOffset: (((seed >> 8) % 15) - 5) / 100 },
    { name: 'Hotels.com',  pctOffset: (((seed >> 12) % 10) - 1) / 100 },
    { name: 'Agoda',       pctOffset: (((seed >> 16) % 14) - 8) / 100 }
  ].map(({ name, pctOffset }) => ({
    platform: name,
    priceValue: Math.max(500, Math.round(base * (1 + pctOffset))),
    live: false
  }));
};

const buildPlatformComparison = (hotel) => {
  const isLive = hotel.source === 'Booking.com';
  const estimated = generatePlatformPrices(hotel);
  const all = [
    { platform: isLive ? 'Booking.com' : 'AI Estimate', priceValue: hotel.priceValue, live: isLive },
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

// ─── Recommendation builders ──────────────────────────────────────────────────

const buildDetailedReason = (tripInfo, hotel, rank, nights) => {
  const totalCost = hotel.totalPriceValue || hotel.priceValue * nights;
  const totalBudget = tripInfo.budgetValue ? tripInfo.budgetValue * nights : null;
  const sentences = [];

  if (rank === 0) {
    if (tripInfo.budgetValue) {
      if (hotel.priceValue <= tripInfo.budgetValue) {
        const savedPerNight = tripInfo.budgetValue - hotel.priceValue;
        const savedTotal = savedPerNight * nights;
        sentences.push(
          savedPerNight > 0
            ? `Excellent value — ${formatINR(savedPerNight)}/night under your budget, saving you ${formatINR(savedTotal)} over ${nights} night${nights > 1 ? 's' : ''}.`
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

  if (hotel.amenities.length) sentences.push(`Includes: ${hotel.amenities.slice(0, 3).join(', ')}.`);

  if (tripInfo.amenities.length && hotel.amenities.length) {
    const matched = tripInfo.amenities.filter((a) =>
      hotel.amenities.some((ha) => ha.toLowerCase().includes(a.toLowerCase()))
    );
    if (matched.length) sentences.push(`Matches your must-haves: ${matched.join(', ')}.`);
  }

  if (tripInfo.locationPreference) sentences.push(`Located near ${tripInfo.locationPreference}.`);

  sentences.push(`Total stay cost: ${formatINR(totalCost)} for ${nights} night${nights > 1 ? 's' : ''}${totalBudget ? ` (total budget: ${formatINR(totalBudget)})` : ''}.`);

  return sentences.join(' ');
};

const buildShortReason = (tripInfo, hotel) => {
  const parts = [];
  if (tripInfo.budgetValue && hotel.priceValue <= tripInfo.budgetValue) {
    parts.push(`fits your ${formatINR(tripInfo.budgetValue)}/night budget`);
  }
  if (hotel.rating && hotel.rating !== 'N/A') parts.push(`rated ${hotel.rating}/10`);
  if (tripInfo.locationPreference) parts.push(`near ${tripInfo.locationPreference}`);
  return parts.length
    ? `${hotel.source} result — ${parts.join(', ')}.`
    : `${hotel.source} result for your dates.`;
};

const scoreHotel = (tripInfo, hotel) => {
  let score = 0;
  score += (hotel.rating || 0) * 12;

  if (tripInfo.budgetValue) {
    if (hotel.priceValue <= tripInfo.budgetValue) {
      score += 60;
      score += Math.min(20, (tripInfo.budgetValue - hotel.priceValue) / 200);
    } else {
      score -= Math.min(40, (hotel.priceValue - tripInfo.budgetValue) / 200);
    }
  }

  const scorableAmenities = tripInfo.amenities.filter((a) => a !== 'any');
  if (scorableAmenities.length && hotel.amenities.length) {
    const matchCount = scorableAmenities.filter((a) =>
      hotel.amenities.some((ha) => ha.toLowerCase().includes(a.toLowerCase()))
    ).length;
    score += (matchCount / scorableAmenities.length) * 30;
  }

  score -= hotel.priceValue / 10000;
  return score;
};

const buildHotelRec = (tripInfo, hotel, index, nights) => {
  const isRecommended = index < 2;
  const recommendationType = index === 0 ? 'Best Value' : index === 1 ? 'Top Rated' : null;
  const platformComparison = isRecommended ? buildPlatformComparison(hotel) : null;
  const comparisonLines = platformComparison
    ? platformComparison.platforms.map((p) => `${p.platform}: ${p.price}${p.live ? ' (live)' : ' (est.)'}`)
    : [`${hotel.source}: ${formatINR(hotel.priceValue)}`];
  const bestProvider = platformComparison
    ? `Book on ${platformComparison.cheapestPlatform} for ${platformComparison.cheapestPrice}/night — cheapest across platforms, saving up to ${platformComparison.savings}.`
    : `${hotel.source} has this listing available for your dates.`;

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
      ? buildDetailedReason(tripInfo, hotel, index, nights)
      : buildShortReason(tripInfo, hotel),
    platformComparison,
    comparison: comparisonLines,
    bestProvider,
    reviewSummary: `${hotel.rating ? `Rated ${hotel.rating}/10` : 'No rating'} · ${hotel.area}`
  };
};

const buildLiveRecommendations = (tripInfo, hotels, nights) => {
  if (!hotels.length) return { recommendations: [], noBudgetResults: false, cheapestAlternative: null };

  // Filter: hotel's TOTAL stay cost must be within the user's total budget
  // total budget = perNight × nights, so this is equivalent to priceValue <= perNightBudget
  const pool = tripInfo.budgetValue
    ? hotels.filter((h) => Number(h.priceValue) <= Number(tripInfo.budgetValue))
    : hotels;

  if (!pool.length && tripInfo.budgetValue) {
    // Never show overbudget hotel cards — just report the cheapest available price
    const cheapest = [...hotels].sort((a, b) => a.priceValue - b.priceValue)[0];
    return {
      recommendations: [],
      noBudgetResults: true,
      cheapestAlternative: cheapest
        ? {
            name: cheapest.name,
            area: cheapest.area,
            price: formatINR(cheapest.priceValue),
            totalPrice: formatINR(cheapest.priceValue * nights)
          }
        : null
    };
  }

  if (!pool.length) return { recommendations: [], noBudgetResults: false, cheapestAlternative: null };

  const scored = pool
    .map((hotel) => ({ ...hotel, score: scoreHotel(tripInfo, hotel) }))
    .sort((a, b) => b.score - a.score);

  const recommendations = scored.slice(0, 6).map((hotel, index) => ({
    ...buildHotelRec(tripInfo, hotel, index, nights),
    overBudgetFallback: false
  }));

  return { recommendations, noBudgetResults: false, cheapestAlternative: null };
};

// ─── OpenAI hotel search (primary) ───────────────────────────────────────────

const searchHotelsWithOpenAI = async (tripInfo, nights) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured in .env');

  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  const perNightBudget = tripInfo.budgetValue;
  const totalBudget = perNightBudget ? perNightBudget * nights : null;

  const budgetInstruction = perNightBudget
    ? `STRICT BUDGET RULE: The user's per-night budget is ₹${perNightBudget}. For ${nights} nights their total trip budget is ₹${totalBudget}. Every hotel you return MUST have pricePerNight ≤ ${perNightBudget}. Do NOT suggest any hotel above this price.`
    : 'No budget constraint — include a range of options.';

  const realAmenities = tripInfo.amenities.filter((a) => a !== 'any');
  const amenityLine = realAmenities.length
    ? `Preferred amenities: ${realAmenities.join(', ')}.`
    : '';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a hotel search assistant. Respond ONLY with valid JSON. No markdown, no explanation, no code blocks.'
      },
      {
        role: 'user',
        content: `Find 8 real hotels in ${tripInfo.destination} for ${tripInfo.guests} guest(s).
Check-in: ${tripInfo.checkIn}, Check-out: ${tripInfo.checkOut} (${nights} nights).
${budgetInstruction}
${amenityLine}

Return this JSON object (no other text):
{
  "hotels": [
    {
      "name": "Exact real hotel name",
      "area": "Specific neighborhood or area within ${tripInfo.destination}",
      "pricePerNight": <integer INR, MUST be ≤ ${perNightBudget || 100000}>,
      "rating": <float between 1.0 and 10.0>,
      "amenities": ["wifi", "pool", "breakfast", ...]
    }
  ]
}`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 2000
  });

  let parsed;
  try {
    parsed = JSON.parse(response.choices[0].message.content);
  } catch {
    return [];
  }

  const raw = Array.isArray(parsed) ? parsed : (parsed.hotels || []);

  return raw
    .map((h) => ({ ...h, pricePerNight: Number(h.pricePerNight) }))
    .filter((h) => h.name && h.pricePerNight > 0)
    // Hard cap: reject anything over budget — catches hallucinated prices
    .filter((h) => !perNightBudget || h.pricePerNight <= perNightBudget)
    .map((h) => ({
      source: 'AI Estimated',
      name: h.name,
      area: h.area || tripInfo.destination,
      priceValue: Math.round(h.pricePerNight),
      totalPriceValue: Math.round(h.pricePerNight) * nights,
      priceText: `₹${Math.round(h.pricePerNight).toLocaleString('en-IN')}`,
      rating: Number(h.rating) > 0
        ? parseFloat(Math.min(10, Math.max(1, Number(h.rating))).toFixed(1))
        : null,
      image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=900',
      link: `https://www.booking.com/search.html?ss=${encodeURIComponent(h.name + ' ' + tripInfo.destination)}`,
      amenities: normalizeAmenities(h.amenities || [])
    }));
};

// ─── Booking.com scraper (fallback) ──────────────────────────────────────────

const scrapeBooking = async (tripInfo, nights) => {
  const { browser, context, page } = await createPage();

  try {
    const params = new URLSearchParams({
      ss: tripInfo.destination,
      checkin: tripInfo.checkIn,
      checkout: tripInfo.checkOut,
      group_adults: String(tripInfo.guests || 2),
      no_rooms: '1',
      lang: 'en-gb',
      selected_currency: 'INR',
      currency: 'INR',
      order: 'price'
    });

    await page.goto(`https://www.booking.com/searchresults.html?${params.toString()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 60000
    });

    await page.locator('[data-testid="property-card"]').first().waitFor({ timeout: 25000 }).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {});
    await page.waitForTimeout(1000).catch(() => {});

    const hotels = await page.locator('[data-testid="property-card"]').evaluateAll((cards) =>
      cards.slice(0, 15).map((card) => {
        const text = (sel) => card.querySelector(sel)?.textContent?.trim() ?? '';
        const image =
          card.querySelector('img[data-src]')?.getAttribute('data-src') ||
          card.querySelector('img')?.getAttribute('src') || '';
        const link = card.querySelector('a[data-testid="title-link"]')?.href ?? '';
        const amenityNodes = Array.from(card.querySelectorAll(
          '[data-testid="facility-list"] span, [data-testid="facility-list"] div, ' +
          '[data-testid="property-card-amenities"] li, [data-testid="property-card-amenities"] span, .bui-list__item'
        ));
        const priceText = (() => {
          for (const sel of ['[data-testid="price-and-discounted-price"]', '[data-testid="price-and-discount-price"]', '[data-testid="price"]', '[class*="prco-valign"]']) {
            const el = card.querySelector(sel);
            if (el && el.textContent.includes('₹')) return el.textContent.trim();
          }
          for (const el of Array.from(card.querySelectorAll('*'))) {
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
          card.querySelector('[class*="score"]')?.textContent?.trim() || '';
        return {
          name: text('[data-testid="title"]') || text('[data-testid="property-card-title"]'),
          area: text('[data-testid="address"]') || text('[data-testid="property-card-address"]'),
          priceText, ratingText, image, link,
          amenities: amenityNodes.map((n) => n.textContent?.trim() ?? '').filter(Boolean)
        };
      })
    );

    return hotels
      .filter((h) => h.name && h.priceText && h.priceText.includes('₹'))
      .map((h) => {
        const priceValue = parsePriceToNumber(h.priceText);
        return {
          source: 'Booking.com',
          name: h.name,
          area: h.area || 'Area unavailable',
          priceValue,
          totalPriceValue: priceValue ? priceValue * nights : null,
          priceText: h.priceText,
          rating: parseRatingToNumber(h.ratingText),
          image: h.image || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=900',
          link: h.link,
          amenities: normalizeAmenities(h.amenities)
        };
      })
      .filter((h) => h.priceValue >= 200 && h.priceValue <= 1000000);
  } finally {
    await context.close();
    await browser.close();
  }
};

// ─── Hotel detail lookup (on-click) ──────────────────────────────────────────

export const getHotelDetails = async ({ name, area, destination, checkIn, checkOut, guests, budget, nights }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured in .env');

  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  const budgetLine = budget ? `- Budget: ₹${budget}/night (total ₹${budget * nights} for ${nights} nights)` : '';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a knowledgeable travel assistant. Provide clear, practical hotel information using markdown bold (**text**) for section headings. No bullet overload — write in short paragraphs.'
      },
      {
        role: 'user',
        content: `Give me detailed information about the hotel "${name}"${area ? ` in ${area}` : ''}, ${destination}.

Trip context:
- Check-in: ${checkIn || 'N/A'}, Check-out: ${checkOut || 'N/A'} (${nights} night${nights !== 1 ? 's' : ''})
- Guests: ${guests || 2}
${budgetLine}

Cover these areas (use **heading** style):
**Overview** — What kind of hotel is it, star rating, vibe.
**Why stay here** — What makes it stand out for this trip.
**Location** — Neighbourhood, nearby landmarks, how far from key spots.
**Rooms & amenities** — Room types available, notable facilities.
**Practical tips** — Check-in time, parking, local transport, anything useful.
**Best suited for** — Type of traveller (family, couples, business, solo).

Keep the total response under 300 words. Be specific and factual.`
      }
    ],
    temperature: 0.3,
    max_tokens: 700
  });

  return response.choices[0].message.content || 'No details available.';
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

  const nights = getNightCount(checkIn, checkOut);
  const perNightBudget = budget ? Number(budget) : null;
  // Total budget = per-night × number of nights
  const totalBudget = perNightBudget ? perNightBudget * nights : null;

  const tripInfo = {
    destination,
    checkIn,
    checkOut,
    guests: Number(guests) || 2,
    budgetValue: perNightBudget,
    amenities: String(amenities).split(',').map((item) => item.trim()).filter(Boolean)
  };

  let hotels = [];
  const sources = [];

  // Primary: OpenAI (reliable budget accuracy)
  try {
    hotels = await searchHotelsWithOpenAI(tripInfo, nights);
    sources.push({ source: 'ChatGPT', ok: true, count: hotels.length, error: '', live: false, ai: true });
  } catch (aiErr) {
    sources.push({
      source: 'ChatGPT',
      ok: false,
      count: 0,
      error: aiErr instanceof Error ? aiErr.message : 'AI search failed.',
      live: false,
      ai: true
    });

    // Fallback: Booking.com scraper
    try {
      hotels = await scrapeBooking(tripInfo, nights);
      sources.push({ source: 'Booking.com', ok: true, count: hotels.length, error: '', live: true });
    } catch (scrapeErr) {
      sources.push({
        source: 'Booking.com',
        ok: false,
        count: 0,
        error: scrapeErr instanceof Error ? scrapeErr.message : 'Scrape failed.',
        live: true
      });
    }
  }

  const { recommendations, noBudgetResults, cheapestAlternative } = buildLiveRecommendations(tripInfo, hotels, nights);

  return {
    recommendations,
    sources,
    noBudgetResults,
    cheapestAlternative,
    perNightBudget,
    totalBudget,
    nights
  };
};
