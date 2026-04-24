const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const EVENTS_AI_MODEL = String(process.env.EVENTS_GEMINI_MODEL || process.env.MEMPHIS_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();

function normalizeLoose(value) {
  return String(value || "").toLowerCase().replace(/pavillion/g, "pavilion").replace(/[^a-z0-9]+/g, " ").trim();
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

function normalizePossibleTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(raw)) return raw.length === 5 ? `${raw}:00` : raw;
  return "";
}

function getGeminiApiKey() {
  return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

function matchLocationGroup(locationGroups, nameOrCode) {
  const needle = normalizeLoose(nameOrCode);
  if (!needle) return null;
  let best = null;
  for (const group of locationGroups || []) {
    const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
    for (const name of names) {
      const normalized = normalizeLoose(name);
      if (!normalized) continue;
      if (needle === normalized || needle.includes(normalized) || normalized.includes(needle)) {
        if (!best || normalized.length > best.matchLength) best = { group, matchLength: normalized.length };
      }
    }
  }
  return best ? best.group : null;
}

function cleanEventName(eventName, locationGroups, matchedGroup) {
  let result = String(eventName || "").trim();
  const groups = matchedGroup ? [matchedGroup] : locationGroups || [];
  for (const group of groups) {
    const names = [group.group_name, group.group_code].concat(group.included_locations || []).filter(Boolean);
    for (const name of names) {
      const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(`\\bat\\s+${escaped}\\b`, "ig"), " ");
      result = result.replace(new RegExp(`\\b${escaped}\\b`, "ig"), " ");
    }
  }
  return result.replace(/\s+/g, " ").replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "").trim();
}

async function callGeminiJson({ prompt, schemaDescription }) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) throw new Error("Gemini parsing is not configured on the server.");
  const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(EVENTS_AI_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `${prompt}\n\nReturn valid JSON only. Schema: ${schemaDescription}` }] }],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || payload?.message || `Gemini HTTP ${response.status}`);
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((part) => typeof part?.text === "string").map((part) => part.text).join("\n").trim();
  if (!text) throw new Error("Gemini returned empty parse output.");
  return JSON.parse(text);
}

export async function aiParseEventTexts({ texts, locationGroups }) {
  const rows = texts.map((text, index) => ({ index, text: String(text || "").trim() })).filter((row) => row.text);
  if (!rows.length) return [];
  const groupCatalog = (locationGroups || []).map((group) => ({ group_name: group.group_name, group_code: group.group_code, included_locations: group.included_locations || [] }));
  const today = new Date().toISOString().slice(0, 10);
  const schemaDescription = JSON.stringify({ type: "array", items: { index: "number", event_name: "string", event_area_name: "string", event_date: "YYYY-MM-DD", start_time: "HH:MM", end_time: "HH:MM", attendee_count: "number|null", notes: "string" } });
  const prompt = [
    "You are parsing custodial event intake for Memphis Zoo.",
    "Extract only the exact event data needed for the system.",
    "Rules:",
    "1. event_name must be only the event name. Do not include the location or area in the event name.",
    "2. event_area_name must be matched to the closest valid area from the catalog.",
    "3. Put leftover useful details into notes.",
    "4. Throw away irrelevant junk.",
    `5. Assume today's date is ${today} when inferring missing years.`,
    "6. Times must be 24-hour HH:MM format.",
    "7. Dates must be YYYY-MM-DD.",
    `Valid area catalog: ${JSON.stringify(groupCatalog)}`,
    `Rows to parse: ${JSON.stringify(rows)}`
  ].join("\n");
  const parsed = await callGeminiJson({ prompt, schemaDescription });
  const byIndex = new Map((Array.isArray(parsed) ? parsed : []).map((row) => [Number(row.index), row]));
  return rows.map((row) => {
    const ai = byIndex.get(row.index) || {};
    const matchedGroup = matchLocationGroup(locationGroups, ai.event_area_name || "");
    const attendeeValue = ai.attendee_count == null || ai.attendee_count === "" ? null : Number.parseInt(String(ai.attendee_count), 10);
    return {
      event_name: cleanEventName(ai.event_name || "", locationGroups, matchedGroup),
      location_group_id: matchedGroup?.location_group_id || "",
      event_date: isIsoDate(ai.event_date) ? ai.event_date : "",
      start_time: normalizePossibleTime(ai.start_time),
      end_time: normalizePossibleTime(ai.end_time),
      attendee_count: Number.isFinite(attendeeValue) ? String(attendeeValue) : null,
      notes: String(ai.notes || "").trim(),
      location_group_name: matchedGroup?.group_name || ai.event_area_name || "",
      created_by: "Input Console AI Parse"
    };
  });
}
