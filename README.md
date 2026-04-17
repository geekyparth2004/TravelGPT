# TravelGPT

TravelGPT is an AI-powered travel planning assistant focused on hotel discovery. It behaves like a specialized travel concierge: it asks the user the right questions, narrows the search using their exact trip needs, compares hotel options across sources, and explains which hotel is the best fit and why.

## Product Vision

People waste time jumping between travel websites, re-entering the same trip details, and manually comparing prices, amenities, ratings, and locations. TravelGPT solves that by turning hotel booking into a guided conversation.

Instead of showing a generic list of hotels, TravelGPT should:

- ask for the exact travel details it needs
- identify what matters most for that specific traveler
- compare relevant hotels from multiple websites
- rank the best options
- explain the reasoning behind every recommendation

## Core Use Case

A user opens TravelGPT because they want help planning a trip and booking a hotel.

TravelGPT starts a conversation and collects the details required to make a useful recommendation:

- destination
- check-in date
- check-out date
- number of guests
- number of rooms if relevant
- budget or target price range
- required amenities
- preferred location or neighborhood
- trip purpose
- hotel style or category
- special constraints

Once the details are complete, TravelGPT compares hotel listings and returns the best available options with price comparisons and personalized reasoning.

## Required Questions

TravelGPT should gather the following information before making final recommendations.

### Trip Basics

- Where are you traveling?
- What is your check-in date?
- What is your check-out date?
- How many guests are traveling?
- How many rooms do you need?

### Budget

- What is your budget per night or total budget?
- Are you looking for luxury, mid-range, or budget-friendly stays?

### Preferences

- Which amenities are mandatory?
- Which amenities are nice to have?
- Do you prefer a hotel, resort, apartment, hostel, or villa?
- Do you want breakfast included, free cancellation, airport shuttle, parking, pool, gym, or Wi-Fi?

### Location

- Do you want to stay near a landmark, city center, airport, beach, or business district?
- How important is walkability or public transport access?

### Traveler Context

- Is this a family trip, solo trip, couple trip, business trip, or group trip?
- Are children, senior citizens, or pets traveling?
- Do you need accessibility-friendly rooms or services?

### Decision Filters

- Is price your top priority, or is comfort/location more important?
- Would you prefer higher-rated properties even if they cost more?
- Are refundable bookings required?

## Conversation Design

TravelGPT should not ask every question at once. It should ask only the missing questions needed to move the search forward.

The assistant should:

- ask short, natural follow-up questions
- avoid repeating questions the user already answered
- summarize collected details back to the user
- confirm unclear or conflicting inputs
- move to recommendations only when the essential fields are complete

Example conversation flow:

1. Ask for destination and dates.
2. Ask for guests and rooms.
3. Ask for budget and required amenities.
4. Ask for location preference and trip type.
5. Confirm the trip summary.
6. Show ranked hotel recommendations.

## Recommendation Engine Expectations

TravelGPT should not return generic hotel suggestions. It should generate recommendations only after evaluating the user context.

Each recommendation should include:

- hotel name
- price per night
- total estimated price
- hotel rating
- review summary
- booking website or websites checked
- important amenities
- distance from preferred area or landmark
- cancellation policy if available
- a short explanation of why this hotel matches the user

## How TravelGPT Should Rank Hotels

TravelGPT should score hotels using a weighted decision model. Example ranking factors:

- price fit with user budget
- match with required amenities
- location relevance
- review quality
- cleanliness and safety signals
- cancellation flexibility
- convenience for the trip purpose
- value for money

Example:

- For a business traveler, proximity to a business district and fast Wi-Fi should have higher weight.
- For a family traveler, room size, breakfast, safety, and family-friendly amenities should have higher weight.
- For a couple trip, ambiance, privacy, and scenic location may matter more.

## Why Current Results May Feel Weak

If TravelGPT collects all details and still produces poor results, the likely issues are product-level rather than UI-level:

- the assistant is not storing structured trip details reliably
- it is not checking enough required fields before recommending hotels
- it is generating generic answers instead of comparing real hotel sources
- it is not using a clear ranking model
- it is not explaining why an option is best for the specific traveler
- it may be using placeholder data instead of live hotel availability and prices

## Functional Requirements

### User Input

- accept trip details through chat
- detect and store structured fields from user messages
- keep the trip summary panel synced with the latest confirmed values
- allow users to correct previous inputs without restarting the conversation

### Search and Comparison

- fetch hotel options from multiple travel sources
- normalize prices, amenities, ratings, and policies
- remove duplicate hotel listings across providers
- compare availability for the exact dates and guest count
- highlight the lowest price or best value offer

### Recommendations

- return 3 to 5 strong matches by default
- explain why each hotel is recommended
- indicate tradeoffs clearly
- separate best overall, best budget, best premium, and best location options when useful

### Trust and Transparency

- explain what data was used for the recommendation
- show when some data is unavailable
- avoid pretending a live price is confirmed if it is not

## Non-Functional Requirements

- fast conversational response time
- mobile-friendly interface
- clear trip summary sidebar
- ability to revise search without losing context
- scalable integration with live travel providers

## Suggested Output Format

When TravelGPT has enough information, its answer should include:

1. A short trip summary.
2. The top hotel recommendations.
3. A comparison of prices from different websites.
4. A plain-language explanation of why each hotel fits.
5. A best overall recommendation.

Example response structure:

- Trip summary: Paris, 12 June to 16 June, 2 guests, under Rs 8,000/night, Wi-Fi and breakfast required, near Eiffel Tower.
- Best overall: Hotel A because it matches the budget, includes breakfast, is highly rated, and is closer to the Eiffel Tower than the alternatives.
- Best budget option: Hotel B because it has the lowest cost with acceptable ratings.
- Best premium option: Hotel C because it offers stronger amenities and better reviews for a moderate increase in price.

## MVP Scope

The first solid version of TravelGPT should do these things well:

- collect all essential trip details through chat
- keep a structured trip state
- ask only for missing details
- show a trip summary in the sidebar
- return personalized hotel recommendations
- explain recommendation quality in plain language

For the MVP, hotel data can be mocked if needed, but the system should be designed so live provider integrations can replace mock data later.

## Future Enhancements

- flight recommendations
- full trip itinerary planning
- map-based hotel exploration
- saved traveler profiles
- budget optimization across transport and stay
- restaurant and activity recommendations
- one-click booking redirection

## Build Direction

To make TravelGPT genuinely useful, the application should evolve from a chat demo into a structured decision assistant. The key shift is:

- from generic AI replies
- to verified, criteria-based hotel recommendations

That means the product needs three strong layers:

- conversational intake
- structured trip state management
- hotel search and ranking logic

## Local Development

Run the app locally:

```bash
npm install
npm run dev
```

Create a production build:

```bash
npm run build
```
