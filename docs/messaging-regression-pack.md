# Memphis Messaging Regression Pack

## Purpose
This pack is the guardrail set for Memphis AI prompt routing. It is meant to catch misroutes between:
- area ownership / schedule questions
- self-schedule questions
- ops manager schedule questions
- internal contact lookups
- general conversation fallbacks

The goal is not just a list of prompts. The goal is prompt family coverage derived from how staff naturally ask the same thing in several different ways.

## Prompt derivation strategy
For each operational intent, derive prompts across these axes:
1. **Question verb**: who has / who covers / who owns / who is at / who is assigned to
2. **Time reference**: today / tomorrow / this afternoon / tonight / Friday
3. **Subject reference**: explicit location name / code / employee name / pronoun follow-up
4. **Formality**: concise / natural / slangy / slightly messy
5. **Follow-up shape**: standalone / thread follow-up / contradiction / correction
6. **Disclosure sensitivity**: asks for schedule only / asks for contact info explicitly

That gives broader coverage than one canonical prompt per intent.

## Route expectations
### Area ownership / location routing
These must route to location or assignment logic, never ops-manager schedule or contacts.
- Who has Aquarium today?
- Who covers Aquarium today?
- Who owns Aquarium today?
- Who is assigned to Aquarium today?
- Aquarium today?
- Who has TETM right now?
- Who has Teton Men’s Restroom this afternoon?
- Who is at Zambezi today?
- Who is covering Event Center?
- Current owner for Aquarium
- Who has the aquarium
- who got aquarium today
- who’s on aquarium
- who is on aquarium today

### Employee self-schedule routing
These must normalize into self-schedule intent when device identity exists.
- What is my schedule today?
- What am I doing today?
- Where am I assigned?
- Where do I go today?
- What area am I in this afternoon?
- Am I working tomorrow?
- What’s my shift?
- Who do I have today?
- What do I have today?

### Employee schedule lookup routing
These must route to employee assignment logic.
- Where is Tammy assigned today?
- What does Tammy have tomorrow?
- What area is Kathy in?
- Who does Brandon cover today?
- Is Jennifer working today?

### Ops manager schedule routing
These should only route to ops-manager schedule logic when the prompt is clearly about ops leadership, not an area.
- Which ops managers work today?
- Who are the ops managers today?
- What is Haley’s schedule tomorrow?
- What days does Jennifer work?
- Eric McKenney schedule today

### Contact lookup routing
These should only disclose phone/contact details when explicitly requested.
- What is Haley’s number?
- Give me Jennifer Sheffield’s phone number
- How do I reach Eric McKenney?
- Contact for facilities manager
- Who is the water quality manager?

These should **not** disclose numbers:
- Is Haley working today?
- Which manager is on today?
- Who has Aquarium today?

### Open coverage / schedule health routing
- What is open today?
- Any open segments at Aquarium?
- What needs coverage this afternoon?
- Who can cover Teton?
- Best backup for Aquarium
- Why is Aquarium open?

### Ticket / maintenance routing
- Any open tickets at Teton?
- Open tickets for Aquarium
- What maintenance issues are open today?

### Event routing
- What events are coming up?
- Anything at Event Center today?
- What is happening tomorrow?

### Conversation / fallback routing
These should stay conversational and not force bad operational guesses.
- Hey
- You alive?
- You connected?
- How are you?

## Parsing / routing hardening rules
1. **Location beats manager**
   - If a known location code or location keyword is present, area/location routing wins over ops-manager schedule and contact lookup.
2. **Schedule is not contact**
   - A schedule question about a person should not expose phone numbers unless contact intent is explicit.
3. **Self-reference gets normalized**
   - “where do I go”, “what do I have today”, and similar first-person prompts should map to self-schedule.
4. **Follow-up inherits subject carefully**
   - If the last subject was a location, short follow-ups should stay on that location unless the new text clearly switches subjects.
5. **Messy phrasing still counts**
   - Sloppy variants like “who got aquarium today” or “whos on aquarium” should still land in area routing.

## Suggested next step
Turn this markdown pack into an executable prompt test harness that records:
- prompt
- expected route
- expected disclosure policy
- expected subject type
- actual result
- pass/fail

That will stop future regressions when Memphis routing changes again.
