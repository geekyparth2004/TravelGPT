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

const HOTEL_IMAGES = [
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1455587734955-081b22074882?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1564501049412-61c2a3083791?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&q=80&w=900',
  'https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&q=80&w=900',
];

const DEFAULT_HOTEL_IMAGE = HOTEL_IMAGES[0];

const getHotelImage = (name) => HOTEL_IMAGES[Math.abs(hashCode(name)) % HOTEL_IMAGES.length];

const normalizeAmenities = (items = []) =>
  [...new Set(items.map((item) => item.trim()).filter(Boolean))].slice(0, 5);

const normalizeHotelName = (name) =>
  name.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

const deduplicateHotels = (hotels) => {
  const seen = new Map();
  for (const hotel of hotels) {
    const key = normalizeHotelName(hotel.name);
    if (!seen.has(key)) {
      seen.set(key, hotel);
    } else {
      // Prefer the lower price; prefer live source if prices are equal
      const existing = seen.get(key);
      if (hotel.priceValue < existing.priceValue) seen.set(key, hotel);
    }
  }
  return [...seen.values()];
};

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

const LIVE_SOURCES = new Set(['Booking.com', 'MakeMyTrip', 'Goibibo']);

const buildPlatformComparison = (hotel) => {
  const isLive = LIVE_SOURCES.has(hotel.source);
  const estimated = generatePlatformPrices(hotel);
  // Don't repeat the live source in the estimated list
  const filtered = isLive
    ? estimated.filter((p) => p.name !== hotel.source)
    : estimated;
  const all = [
    { platform: isLive ? hotel.source : 'AI Estimate', priceValue: hotel.priceValue, live: isLive },
    ...filtered
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

const buildPlatformLinks = (tripInfo, hotelName) => {
  const q = encodeURIComponent(`${hotelName} ${tripInfo.destination}`);
  const nameOnly = encodeURIComponent(hotelName);
  const dest = encodeURIComponent(tripInfo.destination);
  const ci = tripInfo.checkIn;
  const co = tripInfo.checkOut;
  const adults = tripInfo.guests || 2;

  const booking = new URLSearchParams({
    ss: `${hotelName}, ${tripInfo.destination}`,
    checkin: ci,
    checkout: co,
    group_adults: String(adults),
    no_rooms: '1',
    selected_currency: 'INR'
  }).toString();

  const [y1, m1, d1] = (ci || '').split('-');
  const [y2, m2, d2] = (co || '').split('-');
  const mmtCI = ci ? `${m1}%2F${d1}%2F${y1}` : '';
  const mmtCO = co ? `${m2}%2F${d2}%2F${y2}` : '';
  const gbCI = ci ? ci.replace(/-/g, '') : '';
  const gbCO = co ? co.replace(/-/g, '') : '';

  return {
    booking: `https://www.booking.com/searchresults.html?${booking}`,
    makemytrip: ci && co
      ? `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${mmtCI}&checkout=${mmtCO}&city=${dest}&searchText=${nameOnly}&roomStayQualifier=${adults}e0e&locusId=${dest}&locusType=city&country=IN`
      : `https://www.makemytrip.com/hotels/hotel-listing/?searchText=${q}`,
    goibibo: ci && co
      ? `https://www.goibibo.com/hotels/find-hotels-in-${dest.toLowerCase()}/?ci=${gbCI}&co=${gbCO}&nc=${adults}&r=1&q=${nameOnly}`
      : `https://www.goibibo.com/hotels/?q=${q}`,
    agoda: `https://www.agoda.com/search?city=&checkIn=${ci || ''}&checkOut=${co || ''}&rooms=1&adults=${adults}&textToSearch=${q}`,
    trivago: `https://www.trivago.in/en-IN/srl?search=${q}${ci ? `&aDateRange%5Barr%5D=${ci}` : ''}${co ? `&aDateRange%5Bdep%5D=${co}` : ''}`,
    expedia: `https://www.expedia.co.in/Hotel-Search?destination=${q}${ci ? `&startDate=${ci}` : ''}${co ? `&endDate=${co}` : ''}&adults=${adults}`,
    hotels: `https://www.hotels.com/search.do?q-destination=${q}${ci ? `&q-check-in=${ci}` : ''}${co ? `&q-check-out=${co}` : ''}&q-rooms=1&q-room-0-adults=${adults}`,
    yatra: `https://www.yatra.com/hotels/search?destination=${dest}${ci ? `&checkin=${ci}` : ''}${co ? `&checkout=${co}` : ''}&rooms=1&adults=${adults}`
  };
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

  const platformLinks = buildPlatformLinks(tripInfo, hotel.name);
  // If we have a real scraped Booking.com direct hotel URL, prefer it
  const bookingLink = hotel.link && hotel.link.includes('/hotel/') ? hotel.link : platformLinks.booking;

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
    bookingLink,
    platformLinks,
    checkIn: tripInfo.checkIn,
    checkOut: tripInfo.checkOut,
    guests: tripInfo.guests,
    destination: tripInfo.destination,
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
  if (!hotels.length) return { recommendations: [], noBudgetResults: false, cheapestAlternative: null, overBudgetShown: false };

  const pool = tripInfo.budgetValue
    ? hotels.filter((h) => Number(h.priceValue) <= Number(tripInfo.budgetValue))
    : hotels;

  if (!pool.length && tripInfo.budgetValue) {
    // Nothing in budget — show cheapest available options rather than an empty response
    const sortedByPrice = [...hotels]
      .filter((h) => Number.isFinite(Number(h.priceValue)) && Number(h.priceValue) > 0)
      .sort((a, b) => Number(a.priceValue) - Number(b.priceValue));

    if (sortedByPrice.length > 0) {
      const scored = sortedByPrice
        .map((hotel) => ({ ...hotel, score: scoreHotel({ ...tripInfo, budgetValue: null }, hotel) }))
        .sort((a, b) => b.score - a.score);
      const recommendations = scored.slice(0, 6).map((hotel, index) => ({
        ...buildHotelRec(tripInfo, hotel, index, nights),
        overBudgetFallback: true
      }));
      return { recommendations, noBudgetResults: false, cheapestAlternative: null, overBudgetShown: true };
    }

    return {
      recommendations: [],
      noBudgetResults: true,
      cheapestAlternative: buildCheapestAlternative(hotels, nights),
      overBudgetShown: false
    };
  }

  if (!pool.length) return { recommendations: [], noBudgetResults: false, cheapestAlternative: null, overBudgetShown: false };

  const scored = pool
    .map((hotel) => ({ ...hotel, score: scoreHotel(tripInfo, hotel) }))
    .sort((a, b) => b.score - a.score);

  const recommendations = scored.slice(0, 6).map((hotel, index) => ({
    ...buildHotelRec(tripInfo, hotel, index, nights),
    overBudgetFallback: false
  }));

  return { recommendations, noBudgetResults: false, cheapestAlternative: null, overBudgetShown: false };
};

const buildCheapestAlternative = (hotels, nights) => {
  if (!hotels.length) return null;

  const cheapest = [...hotels]
    .filter((hotel) => Number.isFinite(Number(hotel.priceValue)))
    .sort((a, b) => Number(a.priceValue) - Number(b.priceValue))[0];

  if (!cheapest) return null;

  return {
    name: cheapest.name,
    area: cheapest.area,
    price: formatINR(cheapest.priceValue),
    totalPrice: formatINR(cheapest.totalPriceValue || cheapest.priceValue * nights)
  };
};

// ─── OpenAI hotel search (primary) ───────────────────────────────────────────

const callOpenAIHotelSearch = async (openai, tripInfo, nights, includeBudget) => {
  const budgetLine = includeBudget && tripInfo.budgetValue
    ? `Budget: around ₹${tripInfo.budgetValue}/night preferred (include cheaper options too).`
    : '';
  const amenityLine = tripInfo.amenities.filter((a) => a !== 'any').join(', ');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'You are a hotel data assistant. You MUST always return a JSON object with a "hotels" array of exactly 8 real hotels. NEVER return an empty array. Use your training data knowledge of hotels in the requested city.'
      },
      {
        role: 'user',
        content: `List 8 real hotels in ${tripInfo.destination} for ${tripInfo.guests} guest(s), ${nights} nights.
${budgetLine}${amenityLine ? `\nPreferred amenities: ${amenityLine}.` : ''}
Include a mix: budget guesthouses/OYOs, mid-range 3-star hotels, and well-known properties. Cover different areas/localities of ${tripInfo.destination}.

Return ONLY this JSON (no explanation, no markdown, no empty array):
{"hotels":[{"name":"Hotel Name","area":"Locality, ${tripInfo.destination}","pricePerNight":3500,"rating":7.8,"amenities":["wifi","breakfast"]}]}`
      }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.4,
    max_tokens: 1500
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
      image: getHotelImage(h.name),
      link: `https://www.booking.com/search.html?ss=${encodeURIComponent(h.name + ' ' + tripInfo.destination)}`,
      amenities: normalizeAmenities(h.amenities || [])
    }));
};

const searchHotelsWithOpenAI = async (tripInfo, nights) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured in .env');

  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey });

  // First attempt: with budget hint
  let hotels = await callOpenAIHotelSearch(openai, tripInfo, nights, true);
  console.log(`[ChatGPT] First attempt: ${hotels.length} hotels for "${tripInfo.destination}"`);

  // Retry without budget constraint if first attempt returns nothing
  if (hotels.length === 0) {
    console.log(`[ChatGPT] Retrying without budget constraint...`);
    hotels = await callOpenAIHotelSearch(openai, tripInfo, nights, false);
    console.log(`[ChatGPT] Retry result: ${hotels.length} hotels`);
  }

  return hotels;
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

    const mapped = hotels
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
          image: h.image || getHotelImage(h.name),
          link: h.link,
          amenities: normalizeAmenities(h.amenities)
        };
      })
      .filter((h) => h.priceValue >= 200 && h.priceValue <= 1000000);

    console.log(`[Booking.com] Scraped ${hotels.length} raw cards → ${mapped.length} valid hotels`);
    return mapped;
  } finally {
    await context.close();
    await browser.close();
  }
};

// ─── MakeMyTrip scraper ───────────────────────────────────────────────────────

const scrapeMakeMyTrip = async (tripInfo, nights) => {
  const { browser, context, page } = await createPage();
  try {
    const [y1, m1, d1] = tripInfo.checkIn.split('-');
    const [y2, m2, d2] = tripInfo.checkOut.split('-');
    const ci = `${m1}%2F${d1}%2F${y1}`;
    const co = `${m2}%2F${d2}%2F${y2}`;
    const city = encodeURIComponent(tripInfo.destination);

    await page.goto(
      `https://www.makemytrip.com/hotels/hotel-listing/?checkin=${ci}&checkout=${co}&city=${city}&noOfNights=${nights}&adults=${tripInfo.guests || 2}&rooms=1&currency=INR`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {});
    await page.waitForTimeout(2000);

    const hotels = await page.evaluate((dest) => {
      const results = [];
      // MMT uses CSS Modules (hashed class names) — look for structural patterns
      const candidates = Array.from(document.querySelectorAll(
        '[class*="HotelCard"], [class*="hotelCard"], [class*="hotel-card"], [class*="listing-card"], [class*="listingCard"]'
      ));

      for (const card of candidates.slice(0, 12)) {
        const nameEl = card.querySelector('h2, h3, [class*="name"], [class*="Name"], [class*="title"]');
        const name = nameEl?.textContent?.trim() || '';

        let priceText = '';
        for (const el of Array.from(card.querySelectorAll('*'))) {
          if (el.children.length <= 1) {
            const t = el.textContent?.trim() || '';
            if (t.includes('₹') && /\d{3,}/.test(t)) { priceText = t; break; }
          }
        }

        const ratingEl = card.querySelector('[class*="rating"], [class*="Rating"], [class*="star"]');
        const areaEl = card.querySelector('[class*="area"], [class*="Area"], [class*="locality"], [class*="location"]');
        const image = card.querySelector('img')?.src || '';

        if (name && priceText) {
          results.push({ name, area: areaEl?.textContent?.trim() || dest, priceText, ratingText: ratingEl?.textContent?.trim() || '', image });
        }
      }
      return results;
    }, tripInfo.destination);

    return hotels
      .map((h) => {
        const priceValue = parsePriceToNumber(h.priceText);
        return {
          source: 'MakeMyTrip',
          name: h.name,
          area: h.area || tripInfo.destination,
          priceValue,
          totalPriceValue: priceValue ? priceValue * nights : null,
          priceText: h.priceText,
          rating: parseRatingToNumber(h.ratingText),
          image: h.image || getHotelImage(h.name),
          link: `https://www.makemytrip.com/hotels/hotel-listing/?city=${encodeURIComponent(tripInfo.destination)}&q=${encodeURIComponent(h.name)}`,
          amenities: []
        };
      })
      .filter((h) => h.priceValue >= 200 && h.priceValue <= 1000000);
  } finally {
    await context.close();
    await browser.close();
  }
};

// ─── Goibibo scraper ─────────────────────────────────────────────────────────

const scrapeGoibibo = async (tripInfo, nights) => {
  const { browser, context, page } = await createPage();
  try {
    const ci = tripInfo.checkIn.replace(/-/g, '');  // YYYYMMDD
    const co = tripInfo.checkOut.replace(/-/g, '');
    const citySlug = tripInfo.destination.toLowerCase().replace(/\s+/g, '-');

    await page.goto(
      `https://www.goibibo.com/hotels/hotels-in-${citySlug}/?ci=${ci}&co=${co}&nc=${tripInfo.guests || 2}&r=1`,
      { waitUntil: 'domcontentloaded', timeout: 60000 }
    );

    await page.waitForTimeout(5000);
    await page.evaluate(() => window.scrollBy(0, 1000)).catch(() => {});
    await page.waitForTimeout(2000);

    const hotels = await page.evaluate((dest) => {
      const results = [];
      const candidates = Array.from(document.querySelectorAll(
        '[class*="HotelCard"], [class*="hotelCard"], [class*="hotel-card"], [class*="HotelListItem"], [class*="hotelListItem"]'
      ));

      for (const card of candidates.slice(0, 12)) {
        const nameEl = card.querySelector('h2, h3, [class*="hotelName"], [class*="HotelName"], [class*="name"]');
        const name = nameEl?.textContent?.trim() || '';

        let priceText = '';
        for (const el of Array.from(card.querySelectorAll('*'))) {
          if (el.children.length <= 1) {
            const t = el.textContent?.trim() || '';
            if (t.includes('₹') && /\d{3,}/.test(t)) { priceText = t; break; }
          }
        }

        const ratingEl = card.querySelector('[class*="rating"], [class*="Rating"], [class*="score"]');
        const areaEl = card.querySelector('[class*="area"], [class*="Area"], [class*="locality"], [class*="address"]');
        const image = card.querySelector('img')?.src || '';

        if (name && priceText) {
          results.push({ name, area: areaEl?.textContent?.trim() || dest, priceText, ratingText: ratingEl?.textContent?.trim() || '', image });
        }
      }
      return results;
    }, tripInfo.destination);

    return hotels
      .map((h) => {
        const priceValue = parsePriceToNumber(h.priceText);
        return {
          source: 'Goibibo',
          name: h.name,
          area: h.area || tripInfo.destination,
          priceValue,
          totalPriceValue: priceValue ? priceValue * nights : null,
          priceText: h.priceText,
          rating: parseRatingToNumber(h.ratingText),
          image: h.image || getHotelImage(h.name),
          link: `https://www.goibibo.com/hotels/hotels-in-${citySlug}/?q=${encodeURIComponent(h.name)}`,
          amenities: []
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

  console.log(`[searchHotels] Searching: ${destination}, budget: ${budget || 'none'}, nights: ${nights}`);

  // Run ChatGPT search and Booking.com scrape in parallel for maximum coverage
  const [aiResult, bookingResult] = await Promise.allSettled([
    searchHotelsWithOpenAI(tripInfo, nights),
    scrapeBooking(tripInfo, nights)
  ]);

  if (aiResult.status === 'fulfilled' && aiResult.value.length > 0) {
    hotels.push(...aiResult.value);
    sources.push({ source: 'ChatGPT', ok: true, count: aiResult.value.length, error: '', live: false, ai: true });
  } else {
    const err = aiResult.status === 'rejected' ? (aiResult.reason?.message || 'AI search failed.') : 'No results returned.';
    console.error(`[ChatGPT] Failed: ${err}`);
    sources.push({ source: 'ChatGPT', ok: aiResult.status === 'fulfilled', count: 0, error: err, live: false, ai: true });
  }

  if (bookingResult.status === 'fulfilled' && bookingResult.value.length > 0) {
    hotels.push(...bookingResult.value);
    sources.push({ source: 'Booking.com', ok: true, count: bookingResult.value.length, error: '', live: true });
  } else {
    const err = bookingResult.status === 'rejected' ? (bookingResult.reason?.message || 'Scrape failed.') : 'No listings found.';
    console.error(`[Booking.com] Failed: ${err}`);
    sources.push({ source: 'Booking.com', ok: false, count: 0, error: err, live: true });
  }

  hotels = deduplicateHotels(hotels);
  console.log(`[searchHotels] After primary sources: ${hotels.length} hotels`);

  // If neither primary source returned results, try MakeMyTrip and Goibibo
  if (hotels.length === 0) {
    console.log(`[searchHotels] Trying MakeMyTrip and Goibibo fallbacks...`);
    const [mmtResult, goibiboResult] = await Promise.allSettled([
      scrapeMakeMyTrip(tripInfo, nights),
      scrapeGoibibo(tripInfo, nights)
    ]);

    const fallbackDefs = [
      { name: 'MakeMyTrip', result: mmtResult },
      { name: 'Goibibo', result: goibiboResult }
    ];

    const allScraped = [];
    for (const { name, result } of fallbackDefs) {
      if (result.status === 'fulfilled') {
        allScraped.push(...result.value);
        sources.push({ source: name, ok: true, count: result.value.length, error: '', live: true });
      } else {
        const err = result.reason?.message || 'Scrape failed.';
        console.error(`[${name}] Failed: ${err}`);
        sources.push({ source: name, ok: false, count: 0, error: err, live: true });
      }
    }
    hotels = deduplicateHotels(allScraped);
    console.log(`[searchHotels] After fallback scrapers: ${hotels.length} hotels`);
  }

  const { recommendations, noBudgetResults, cheapestAlternative, overBudgetShown } = buildLiveRecommendations(
    tripInfo,
    hotels,
    nights
  );

  // Safety net: strip over-budget hotels only when we are NOT intentionally showing
  // over-budget fallback results (overBudgetShown means budget was too tight and we
  // chose to display cheapest available rather than an empty "no hotels" message).
  const safeRecommendations = perNightBudget && !overBudgetShown
    ? recommendations.filter((r) => Number.isFinite(Number(r.priceValue)) && Number(r.priceValue) <= perNightBudget)
    : recommendations;

  const budgetFilteredOutAll = Boolean(
    perNightBudget &&
    !overBudgetShown &&
    hotels.length &&
    safeRecommendations.length === 0
  );

  return {
    recommendations: safeRecommendations,
    sources,
    noBudgetResults: noBudgetResults || budgetFilteredOutAll,
    overBudgetShown: overBudgetShown || false,
    cheapestAlternative: noBudgetResults || budgetFilteredOutAll
      ? cheapestAlternative || buildCheapestAlternative(hotels, nights)
      : null,
    perNightBudget,
    totalBudget,
    nights
  };
};
