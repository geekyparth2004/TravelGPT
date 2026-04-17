import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ExternalLink, Hotel, List, MapPin, Plane, Send, Sparkles, User, Users } from 'lucide-react';
import './index.css';

const AMENITY_KEYWORDS = [
  'wifi',
  'breakfast',
  'pool',
  'gym',
  'spa',
  'parking',
  'airport shuttle',
  'beach access',
  'pet friendly',
  'free cancellation',
  'workspace',
  'family rooms'
];

const KNOWN_DESTINATIONS = ['goa', 'paris', 'dubai', 'london', 'tokyo', 'bali', 'new york', 'singapore', 'bangkok', 'rome'];

const MONTH_LOOKUP = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12
};

const EMPTY_TRIP_INFO = {
  destination: '',
  checkIn: '',
  checkOut: '',
  guests: '',
  rooms: '',
  budget: '',
  budgetValue: null,
  amenities: [],
  tripType: '',
  locationPreference: ''
};

const INTRO_MESSAGE =
  "Hello! I'm TravelGPT. Tell me where you're going, your check-in and check-out dates, number of guests, budget in rupees, and the must-have amenities you care about.";

const API_BASE_CANDIDATES = [
  import.meta.env.VITE_API_BASE,
  typeof window !== 'undefined' && window.location.protocol.startsWith('http') ? '' : null,
  'http://localhost:8787'
].filter(Boolean);

const cleanValue = (value) => value.trim().replace(/[.,;!?]+$/, '');

const titleCase = (value) =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const formatCurrency = (value) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(Math.round(value));

const getNightCount = (checkIn, checkOut) => {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(`${checkIn}T00:00:00Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00Z`).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return 0;
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
};

const formatDateForDisplay = (isoDate) => {
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  if (!year || !month || !day) return isoDate;
  return `${day}-${month}-${year}`;
};

const formatDates = (checkIn, checkOut) => {
  if (!checkIn && !checkOut) return '';
  if (checkIn && checkOut) return `${formatDateForDisplay(checkIn)} to ${formatDateForDisplay(checkOut)}`;
  return formatDateForDisplay(checkIn || checkOut);
};

const parseDateText = (text) => {
  const cleaned = cleanValue(text).toLowerCase();
  if (!cleaned) return '';

  const isoMatch = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const slashMatch = cleaned.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (slashMatch) {
    const day = String(Number(slashMatch[1])).padStart(2, '0');
    const month = String(Number(slashMatch[2])).padStart(2, '0');
    return `${slashMatch[3]}-${month}-${day}`;
  }

  const monthNameMatch = cleaned.match(
    /\b(\d{1,2})\s+([a-z]+)\s+(\d{4})\b|\b([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(\d{4})\b/
  );

  if (monthNameMatch) {
    if (monthNameMatch[1] && monthNameMatch[2] && monthNameMatch[3]) {
      const month = MONTH_LOOKUP[monthNameMatch[2]];
      if (month) {
        const day = String(Number(monthNameMatch[1])).padStart(2, '0');
        return `${monthNameMatch[3]}-${String(month).padStart(2, '0')}-${day}`;
      }
    }

    if (monthNameMatch[4] && monthNameMatch[5] && monthNameMatch[6]) {
      const month = MONTH_LOOKUP[monthNameMatch[4]];
      if (month) {
        const day = String(Number(monthNameMatch[5])).padStart(2, '0');
        return `${monthNameMatch[6]}-${String(month).padStart(2, '0')}-${day}`;
      }
    }
  }

  return '';
};

const uniqueValues = (items) => [...new Set(items.filter(Boolean))];

const extractDestination = (text) => {
  const lowered = text.toLowerCase();
  const knownMatch = KNOWN_DESTINATIONS.find((place) => lowered.includes(place));
  if (knownMatch) return titleCase(knownMatch);

  const patterns = [
    /(?:going to|travel(?:ing)? to|trip to|heading to|visit(?:ing)?|destination is)\s+([a-z][a-z\s'-]+?)(?=\s+(?:from|between|for|with|under|budget|need|want|near)\b|[.!?,]|$)/i,
    /(?:in)\s+([a-z][a-z\s'-]+?)(?=\s+(?:from|between|for|with|under|budget|need|want|near)\b|[.!?,]|$)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return titleCase(cleanValue(match[1]));
  }

  return '';
};

const extractDateFields = (text) => {
  const result = { checkIn: '', checkOut: '' };
  const checkInMatch = text.match(/(?:check[- ]?in|arriving|arrival)\s*(?:on)?\s*[:-]?\s*([a-z0-9,\-/ ]+)/i);
  const checkOutMatch = text.match(/(?:check[- ]?out|leaving|departure)\s*(?:on)?\s*[:-]?\s*([a-z0-9,\-/ ]+)/i);
  const rangeMatch = text.match(
    /(?:from|between)\s+([a-z0-9,\-/ ]+?)\s+(?:to|until|through|-)\s+([a-z0-9,\-/ ]+?)(?=\s+(?:for|with|under|budget|need|want|near)\b|[.!?,]|$)/i
  );

  if (rangeMatch?.[1] && rangeMatch?.[2]) {
    result.checkIn = parseDateText(rangeMatch[1]);
    result.checkOut = parseDateText(rangeMatch[2]);
    return result;
  }

  if (checkInMatch?.[1]) result.checkIn = parseDateText(checkInMatch[1]);
  if (checkOutMatch?.[1]) result.checkOut = parseDateText(checkOutMatch[1]);

  if (!result.checkIn || !result.checkOut) {
    const parsedMatches = text
      .split(/\b(?:to|until|through|-)\b/i)
      .map((segment) => parseDateText(segment))
      .filter(Boolean);

    if (parsedMatches.length >= 2) {
      result.checkIn = result.checkIn || parsedMatches[0];
      result.checkOut = result.checkOut || parsedMatches[1];
    }
  }

  return result;
};

const extractGuests = (text) => {
  const match =
    text.match(/(?:for|with)\s+(\d+)\s+(?:guest(?:s)?|people|adults|traveler(?:s)?|traveller(?:s)?)/i) ||
    text.match(/(\d+)\s+(?:guest(?:s)?|people|adults|traveler(?:s)?|traveller(?:s)?)/i);

  return match?.[1] ? Number(match[1]) : '';
};

const extractRooms = (text) => {
  const match = text.match(/(\d+)\s+room(?:s)?/i);
  return match?.[1] ? Number(match[1]) : '';
};

const extractBudget = (text) => {
  const match =
    text.match(/(?:budget|under|below|less than|up to|max(?:imum)?)\s*(?:of\s*)?(?:rs\.?|inr|rupees?|₹)?\s*(\d[\d,]*)/i) ||
    text.match(/(?:rs\.?|inr|rupees?|₹)\s*(\d[\d,]*)/i);

  if (!match?.[1]) return { budget: '', budgetValue: null };

  const numeric = Number(match[1].replace(/,/g, ''));
  if (!numeric) return { budget: '', budgetValue: null };

  return {
    budget: `Under ${formatCurrency(numeric)}/night`,
    budgetValue: numeric
  };
};

const extractAmenities = (text) => {
  const lowered = text.toLowerCase();
  return uniqueValues(AMENITY_KEYWORDS.filter((amenity) => lowered.includes(amenity)));
};

const extractTripType = (text) => {
  const lowered = text.toLowerCase();
  const matches = [
    ['family', 'family'],
    ['business', 'business'],
    ['work trip', 'business'],
    ['solo', 'solo'],
    ['couple', 'couple'],
    ['honeymoon', 'couple'],
    ['group', 'group'],
    ['luxury', 'luxury'],
    ['budget', 'budget']
  ];

  const match = matches.find(([keyword]) => lowered.includes(keyword));
  return match ? match[1] : '';
};

const extractLocationPreference = (text) => {
  const match = text.match(
    /(?:near|close to|around|stay near|prefer near)\s+([a-z0-9\s'-]+?)(?=\s+(?:with|for|under|budget|need|want)\b|[.!?,]|$)/i
  );
  return match?.[1] ? titleCase(cleanValue(match[1])) : '';
};

const extractTripInfoFromText = (text) => {
  const destination = extractDestination(text);
  const dates = extractDateFields(text);
  const guests = extractGuests(text);
  const rooms = extractRooms(text);
  const budget = extractBudget(text);
  const amenities = extractAmenities(text);
  const tripType = extractTripType(text);
  const locationPreference = extractLocationPreference(text);

  return {
    destination,
    checkIn: dates.checkIn,
    checkOut: dates.checkOut,
    guests,
    rooms,
    budget: budget.budget,
    budgetValue: budget.budgetValue,
    amenities,
    tripType,
    locationPreference
  };
};

const extractFieldFromDirectAnswer = (text, field) => {
  const cleaned = cleanValue(text);

  switch (field) {
    case 'destination':
      return cleaned ? { destination: titleCase(cleaned) } : {};
    case 'checkIn': {
      const parsedDate = parseDateText(cleaned);
      return parsedDate ? { checkIn: parsedDate } : {};
    }
    case 'checkOut': {
      const parsedDate = parseDateText(cleaned);
      return parsedDate ? { checkOut: parsedDate } : {};
    }
    case 'guests': {
      const count = cleaned.match(/\d+/);
      return count ? { guests: Number(count[0]) } : {};
    }
    case 'budget': {
      const parsedBudget = extractBudget(cleaned);
      if (parsedBudget.budgetValue) return { budget: parsedBudget.budget, budgetValue: parsedBudget.budgetValue };
      const numericOnly = cleaned.match(/\d[\d,]*/);
      if (!numericOnly) return {};
      const numericValue = Number(numericOnly[0].replace(/,/g, ''));
      if (!numericValue) return {};
      return {
        budget: `Under ${formatCurrency(numericValue)}/night`,
        budgetValue: numericValue
      };
    }
    case 'amenities': {
      const amenities = extractAmenities(cleaned);
      if (amenities.length) return { amenities };
      const rawAmenities = cleaned
        .split(/,|and/i)
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);
      return rawAmenities.length ? { amenities: rawAmenities } : {};
    }
    default:
      return {};
  }
};

const mergeTripInfo = (prev, updates) => ({
  ...prev,
  destination: updates.destination || prev.destination,
  checkIn: updates.checkIn || prev.checkIn,
  checkOut: updates.checkOut || prev.checkOut,
  guests: updates.guests || prev.guests,
  rooms: updates.rooms || prev.rooms,
  budget: updates.budget || prev.budget,
  budgetValue: updates.budgetValue || prev.budgetValue,
  amenities: uniqueValues([...(prev.amenities || []), ...(updates.amenities || [])]),
  tripType: updates.tripType || prev.tripType,
  locationPreference: updates.locationPreference || prev.locationPreference
});

const getMissingFields = (tripInfo) => {
  const missing = [];
  if (!tripInfo.destination) missing.push('destination');
  if (!tripInfo.checkIn) missing.push('checkIn');
  if (!tripInfo.checkOut) missing.push('checkOut');
  if (!tripInfo.guests) missing.push('guests');
  if (!tripInfo.budgetValue) missing.push('budget');
  if (!tripInfo.amenities.length) missing.push('amenities');
  return missing;
};

const getQuestionForField = (field) => {
  switch (field) {
    case 'destination':
      return 'Which destination are you traveling to?';
    case 'checkIn':
      return 'Please choose your check-in date.';
    case 'checkOut':
      return 'What is your check-out date?';
    case 'guests':
      return 'How many guests are traveling?';
    case 'budget':
      return 'What budget per night should I stay under in rupees?';
    case 'amenities':
      return 'Which amenities are must-haves for this trip, such as Wi-Fi, breakfast, pool, or free cancellation?';
    default:
      return 'Tell me a little more about your trip.';
  }
};

const getTripSummary = (tripInfo) => {
  const summaryParts = [
    tripInfo.destination,
    formatDates(tripInfo.checkIn, tripInfo.checkOut),
    tripInfo.guests ? `${tripInfo.guests} guest${tripInfo.guests > 1 ? 's' : ''}` : '',
    tripInfo.budget,
    tripInfo.amenities.length ? tripInfo.amenities.join(', ') : '',
    tripInfo.locationPreference ? `near ${tripInfo.locationPreference}` : '',
    tripInfo.tripType ? `${tripInfo.tripType} trip` : ''
  ];

  return summaryParts.filter(Boolean).join(' | ');
};

const fetchLiveRecommendations = async (tripInfo) => {
  const params = new URLSearchParams({
    destination: tripInfo.destination,
    checkIn: tripInfo.checkIn,
    checkOut: tripInfo.checkOut,
    guests: String(tripInfo.guests || 2),
    budget: tripInfo.budgetValue ? String(tripInfo.budgetValue) : '',
    amenities: tripInfo.amenities.join(',')
  });

  let lastError = 'Live hotel search failed.';

  for (const baseUrl of API_BASE_CANDIDATES) {
    const normalizedBase = baseUrl === '' ? '' : baseUrl.replace(/\/$/, '');
    const requestUrl = `${normalizedBase}/api/hotels/search?${params.toString()}`;

    try {
      const response = await fetch(requestUrl);
      if (!response.ok) {
        const errorPayload = await response.text();
        lastError = errorPayload || `Live hotel search failed with status ${response.status}.`;
        continue;
      }

      return response.json();
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Live hotel search failed.';
    }
  }

  throw new Error(lastError);
};

const createRecommendationsMessage = (tripInfo, payload) => {
  const summary = getTripSummary(tripInfo);
  const destination = tripInfo.destination || 'your destination';
  const nights = payload.nights || getNightCount(tripInfo.checkIn, tripInfo.checkOut);
  const totalBudget = payload.totalBudget || (tripInfo.budgetValue && nights ? tripInfo.budgetValue * nights : null);

  if (payload.noBudgetResults) {
    const cheapest = payload.cheapestAlternative;
    const budgetSummary = totalBudget
      ? ` (₹${tripInfo.budgetValue.toLocaleString('en-IN')}/night × ${nights} nights = ₹${totalBudget.toLocaleString('en-IN')} total budget)`
      : '';
    const cheapestLine = cheapest
      ? ` The lowest option available is **${cheapest.name}** at ${cheapest.price}/night (${cheapest.totalPrice} total for ${nights} nights).`
      : '';
    const cardBlock = payload.recommendations.length
      ? `\n\`\`\`json\n${JSON.stringify({ recommendations: payload.recommendations }, null, 2)}\n\`\`\``
      : '';
    return `No hotels found within your budget${budgetSummary} for ${destination}.${cheapestLine}\n\nTrip summary: ${summary}${cardBlock}`;
  }

  if (!payload.recommendations.length) {
    const budgetLine = totalBudget
      ? ` within your total budget of ₹${totalBudget.toLocaleString('en-IN')} (₹${tripInfo.budgetValue.toLocaleString('en-IN')}/night × ${nights} nights)`
      : '';
    return `I searched but found no hotels${budgetLine} for ${destination} on those dates.\n\nTrip summary: ${summary}.\n\nTry searching directly on:\n• Booking.com\n• Expedia\n• MakeMyTrip\n• Trivago`;
  }

  const aiSource = (payload.sources || []).find((s) => s.ai && s.ok);
  const sourceNote = aiSource
    ? `${aiSource.count} hotel${aiSource.count === 1 ? '' : 's'} found via ChatGPT · prices compared across Booking.com, Expedia, MakeMyTrip, Trivago, Hotels.com & Agoda`
    : `Prices compared across Booking.com, Expedia, MakeMyTrip, Trivago & more`;

  const top = payload.recommendations[0];
  const budgetClause = totalBudget
    ? ` within your total budget of ₹${totalBudget.toLocaleString('en-IN')} (₹${tripInfo.budgetValue.toLocaleString('en-IN')}/night × ${nights} nights)`
    : '';
  return `Here are hotels for your trip to ${destination}. Found ${payload.recommendations.length} option${payload.recommendations.length === 1 ? '' : 's'}${budgetClause}.\n\n${summary}\n${sourceNote}\n\nTop pick: **${top.name}** at ${top.price}/night (${top.totalPrice} total for ${nights} nights).\n\`\`\`json
${JSON.stringify({ recommendations: payload.recommendations }, null, 2)}
\`\`\``;
};

const generateAssistantReply = async (tripInfo) => {
  const missingFields = getMissingFields(tripInfo);

  if (missingFields.length) {
    const summary = getTripSummary(tripInfo);
    const summaryLine = summary ? `I have so far: ${summary}.\n\n` : '';
    return {
      role: 'assistant',
      content: `${summaryLine}${getQuestionForField(missingFields[0])}`
    };
  }

  try {
    const payload = await fetchLiveRecommendations(tripInfo);
    return {
      role: 'assistant',
      content: createRecommendationsMessage(tripInfo, payload)
    };
  } catch (error) {
    return {
      role: 'assistant',
      content:
        error instanceof Error
          ? `I couldn't complete the live hotel search right now. ${error.message}`
          : "I couldn't complete the live hotel search right now."
    };
  }
};

function App() {
  const [messages, setMessages] = useState([{ role: 'assistant', content: INTRO_MESSAGE }]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [tripInfo, setTripInfo] = useState(EMPTY_TRIP_INFO);
  const [dateDraft, setDateDraft] = useState('');
  const messagesEndRef = useRef(null);
  const dateInputRef = useRef(null);

  const missingFields = getMissingFields(tripInfo);
  const activeDateField = ['checkIn', 'checkOut'].includes(missingFields[0]) ? missingFields[0] : '';
  const dateFieldLabel = activeDateField === 'checkOut' ? 'check-out' : 'check-in';
  const activeDateValue = activeDateField === 'checkOut' ? tripInfo.checkOut : tripInfo.checkIn;
  const visibleDateValue = dateDraft || activeDateValue || '';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  useEffect(() => {
    if (!activeDateField) return;
    const inputNode = dateInputRef.current;
    if (!inputNode) return;

    const timer = setTimeout(() => {
      inputNode.focus();
      if (typeof inputNode.showPicker === 'function') {
        try {
          inputNode.showPicker();
        } catch {
          // Browser may require a user gesture.
        }
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [activeDateField, tripInfo.checkIn, tripInfo.checkOut]);

  const parseMessageContent = (content) => {
    if (content.includes('```json')) {
      const parts = content.split('```json');
      const textPart = parts[0];
      const jsonText = parts[1].split('```')[0];

      try {
        return { text: textPart, data: JSON.parse(jsonText) };
      } catch {
        return { text: content, data: null };
      }
    }

    return { text: content, data: null };
  };

  const handleSend = async (event) => {
    event.preventDefault();
    if (!input.trim() || isTyping) return;

    const userMessage = input.trim();
    const currentMissingFields = getMissingFields(tripInfo);
    const extractedTripInfo = extractTripInfoFromText(userMessage);
    const contextualTripInfo = currentMissingFields.length ? extractFieldFromDirectAnswer(userMessage, currentMissingFields[0]) : {};
    const nextTripInfo = mergeTripInfo(tripInfo, {
      ...extractedTripInfo,
      ...contextualTripInfo
    });

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setTripInfo(nextTripInfo);
    setIsTyping(true);

    await new Promise((resolve) => setTimeout(resolve, 350));

    const assistantMessage = await generateAssistantReply(nextTripInfo);
    setMessages((prev) => [...prev, assistantMessage]);
    setIsTyping(false);
  };

  const handleDateSave = async () => {
    if (!activeDateField || !visibleDateValue) return;

    const nextTripInfo = {
      ...tripInfo,
      [activeDateField]: visibleDateValue
    };

    setTripInfo(nextTripInfo);
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: `${dateFieldLabel === 'check-in' ? 'Check-in' : 'Check-out'} date selected: ${formatDateForDisplay(visibleDateValue)}`
      }
    ]);
    setDateDraft('');
    setIsTyping(true);

    const assistantMessage = await generateAssistantReply(nextTripInfo);
    setMessages((prev) => [...prev, assistantMessage]);
    setIsTyping(false);
  };

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-container">
          <Sparkles className="logo-icon" size={28} />
          <h1 className="logo-text">TravelGPT</h1>
        </div>
        <div className="avatar-shell">
          <div className="avatar-gradient">
            <User size={18} color="white" />
          </div>
        </div>
      </header>

      <div className="chat-wrapper">
        <aside className="sidebar">
          <div className="sidebar-section">
            <h3 className="sidebar-title">Trip Details</h3>

            <div className="trip-detail">
              <MapPin className="trip-detail-icon" />
              <span>{tripInfo.destination || <span className="empty-state">Destination unknown</span>}</span>
            </div>
            <div className="trip-detail">
              <Calendar className="trip-detail-icon" />
              <span>{formatDates(tripInfo.checkIn, tripInfo.checkOut) || <span className="empty-state">Dates not set</span>}</span>
            </div>
            <div className="trip-detail">
              <Users className="trip-detail-icon" />
              <span>
                {tripInfo.guests
                  ? `${tripInfo.guests} guest${tripInfo.guests > 1 ? 's' : ''}${tripInfo.rooms ? `, ${tripInfo.rooms} room${tripInfo.rooms > 1 ? 's' : ''}` : ''}`
                  : <span className="empty-state">Guests unknown</span>}
              </span>
            </div>
            <div className="trip-detail">
              <List className="trip-detail-icon" />
              <span>
                {tripInfo.budget ? (() => {
                  const nights = getNightCount(tripInfo.checkIn, tripInfo.checkOut);
                  const total = tripInfo.budgetValue && nights > 0 ? tripInfo.budgetValue * nights : null;
                  return total
                    ? `${tripInfo.budget} · Total ${formatCurrency(total)} for ${nights}n`
                    : tripInfo.budget;
                })() : <span className="empty-state">No budget info</span>}
              </span>
            </div>
            <div className="trip-detail">
              <Hotel className="trip-detail-icon" />
              <span>{tripInfo.amenities.length ? tripInfo.amenities.join(', ') : <span className="empty-state">Amenities not chosen</span>}</span>
            </div>
            <div className="trip-detail">
              <Plane className="trip-detail-icon" />
              <span>
                {tripInfo.tripType || tripInfo.locationPreference
                  ? [tripInfo.tripType ? `${tripInfo.tripType} trip` : '', tripInfo.locationPreference ? `near ${tripInfo.locationPreference}` : '']
                      .filter(Boolean)
                      .join(' | ')
                  : <span className="empty-state">Trip style not set</span>}
              </span>
            </div>
          </div>

          <div className="sidebar-section sidebar-note">
            <p className="sidebar-note-title">Live Search Mode</p>
            <p className="sidebar-note-copy">
              TravelGPT now tries live hotel scraping when all required details are complete. Source failures are shown explicitly instead of replaced with fake data.
            </p>
          </div>
        </aside>

        <main className="chat-main">
          <div className="message-list">
            {messages.map((message, index) => {
              const { text, data } = parseMessageContent(message.content);

              return (
                <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
                  <div className="message-content">
                    <div className="message-text">{text}</div>
                    {data?.recommendations && (
                      <div className="hotel-cards-container">
                        {data.recommendations.map((hotel, hotelIndex) => (
                          <div
                            key={`${hotel.name}-${hotelIndex}`}
                            className={`hotel-card${hotel.isRecommended ? ' hotel-card--recommended' : ''}`}
                          >
                            {hotel.recommendationType && (
                              <div className={`hotel-recommended-badge hotel-recommended-badge--${hotel.recommendationType === 'Best Value' ? 'value' : 'rated'}`}>
                                {hotel.recommendationType === 'Best Value' ? '🏆' : '⭐'} {hotel.recommendationType}
                              </div>
                            )}
                            <div className="hotel-img-wrapper">
                              <img src={hotel.image} alt={hotel.name} className="hotel-img" />
                              <div className="hotel-rating-badge">
                                <span className="star">★</span> {hotel.rating}
                              </div>
                            </div>
                            <div className="hotel-details">
                              <div className="hotel-header">
                                <div>
                                  <h4 className="hotel-title">{hotel.name}</h4>
                                  <p className="hotel-area">
                                    <MapPin size={12} style={{ display: 'inline', marginRight: 3 }} />
                                    {hotel.area}
                                  </p>
                                </div>
                                <div className="hotel-price-block">
                                  <div className="hotel-price">
                                    {hotel.price} <span>/night</span>
                                  </div>
                                  <div className="hotel-total">{hotel.totalPrice} total · {hotel.nights}n</div>
                                </div>
                              </div>

                              <div className="hotel-amenities">
                                {(hotel.amenities || []).map((amenity, i) => (
                                  <span key={`${amenity}-${i}`} className="amenity-tag">{amenity}</span>
                                ))}
                              </div>

                              {hotel.platformComparison && (
                                <div className="price-comparison">
                                  <div className="price-comparison-title">Price comparison across platforms</div>
                                  <div className="price-comparison-grid">
                                    {hotel.platformComparison.platforms.map((p) => (
                                      <div key={p.platform} className={`price-row${p.isCheapest ? ' price-row--cheapest' : ''}`}>
                                        <span className="price-row-platform">
                                          {p.isCheapest && <span className="cheapest-badge">✓</span>}
                                          {p.platform}
                                          {!p.live && <span className="est-label"> est.</span>}
                                        </span>
                                        <span className="price-row-amount">{p.price}/night</span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="price-savings-note">
                                    Book on <strong>{hotel.platformComparison.cheapestPlatform}</strong> for <strong>{hotel.platformComparison.cheapestPrice}/night</strong> — save up to {hotel.platformComparison.savings}
                                  </div>
                                </div>
                              )}

                              {hotel.isRecommended && (
                                <div className="why-recommended">
                                  <div className="why-recommended-title">Why we recommend this</div>
                                  <p className="why-recommended-body">{hotel.reason}</p>
                                </div>
                              )}

                              {!hotel.isRecommended && (
                                <div className="hotel-reason">{hotel.reason}</div>
                              )}

                              <div className="hotel-actions">
                                {hotel.bookingLink ? (
                                  <a className="hotel-link hotel-link--primary" href={hotel.bookingLink} target="_blank" rel="noreferrer">
                                    Book on Booking.com <ExternalLink size={13} />
                                  </a>
                                ) : (
                                  <a className="hotel-link hotel-link--primary" href={`https://www.booking.com/search.html?ss=${encodeURIComponent(hotel.name)}`} target="_blank" rel="noreferrer">
                                    Search on Booking.com <ExternalLink size={13} />
                                  </a>
                                )}
                                {hotel.platformComparison?.cheapestPlatform && hotel.platformComparison.cheapestPlatform !== 'Booking.com' && (
                                  <a
                                    className="hotel-link hotel-link--secondary"
                                    href={
                                      hotel.platformComparison.cheapestPlatform === 'MakeMyTrip'
                                        ? `https://www.makemytrip.com/hotels/hotel-listing/?searchText=${encodeURIComponent(hotel.name)}`
                                        : hotel.platformComparison.cheapestPlatform === 'Agoda'
                                        ? `https://www.agoda.com/search?city=${encodeURIComponent(hotel.name)}`
                                        : hotel.platformComparison.cheapestPlatform === 'Trivago'
                                        ? `https://www.trivago.in/?q=${encodeURIComponent(hotel.name)}`
                                        : hotel.platformComparison.cheapestPlatform === 'Expedia'
                                        ? `https://www.expedia.com/Hotel-Search?destination=${encodeURIComponent(hotel.name)}`
                                        : `https://www.hotels.com/search.do?q=${encodeURIComponent(hotel.name)}`
                                    }
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Check {hotel.platformComparison.cheapestPlatform} <ExternalLink size={11} />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="message-time">{message.role === 'assistant' ? 'TravelGPT' : 'You'}</span>
                </div>
              );
            })}

            {isTyping && (
              <div className="message assistant">
                <div className="typing-indicator">
                  <div className="dot"></div>
                  <div className="dot"></div>
                  <div className="dot"></div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {activeDateField && (
            <div className="date-picker-dock">
              <div className="date-picker-copy">
                <p className="date-picker-title">Choose your {dateFieldLabel} date</p>
                <p className="date-picker-subtitle">The calendar opens here when TravelGPT needs that date.</p>
              </div>
              <div className="date-picker-inline">
                <input
                  ref={dateInputRef}
                  className="date-native-input"
                  type="date"
                  value={visibleDateValue}
                  min={activeDateField === 'checkOut' && tripInfo.checkIn ? tripInfo.checkIn : undefined}
                  onChange={(event) => setDateDraft(event.target.value)}
                />
                <button type="button" className="date-save-btn" onClick={handleDateSave} disabled={!visibleDateValue}>
                  Save {dateFieldLabel}
                </button>
              </div>
            </div>
          )}

          <form className="input-area" onSubmit={handleSend}>
            <div className="input-wrapper">
              <input
                type="text"
                className="chat-input"
                placeholder="Example: I need a hotel in Goa from 10 May 2026 to 14 May 2026 for 2 guests under Rs 8,000 with wifi and breakfast"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={isTyping}
              />
            </div>
            <button type="submit" className="send-btn" disabled={!input.trim() || isTyping}>
              <Send size={18} />
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}

export default App;
