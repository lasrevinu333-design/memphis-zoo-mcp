export const DEFAULT_WEATHER_LOCATION = "Memphis Zoo, Memphis, Tennessee";
// LOW #6: Make Memphis Zoo coordinates configurable via env var instead of hardcoded.
const MEMPHIS_ZOO_LATITUDE = Number.parseFloat(String(process.env.MEMPHIS_ZOO_LATITUDE || "35.1506"));
const MEMPHIS_ZOO_LONGITUDE = Number.parseFloat(String(process.env.MEMPHIS_ZOO_LONGITUDE || "-89.9944"));
// MEDIUM #10: Timeout for weather API calls.
const WEATHER_API_TIMEOUT_MS = Number.parseInt(String(process.env.MEMPHIS_WEATHER_API_TIMEOUT_MS || "8000"), 10);

// MEDIUM #10: Shared fetchWithTimeout for weather API calls.
async function weatherFetchWithTimeout(url, options = {}, timeoutMs = WEATHER_API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 8000));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function isWeatherQuestion(text = "") {
  return /\b(weather|forecast|temperature|rain|storm|sunny|cloudy|wind|humid|humidity)\b/i.test(String(text || ""));
}

export function mentionsMemphisPlace(text = "") {
  return /\bmemphis\b/i.test(String(text || ""));
}

function extractExplicitWeatherLocation(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const match = raw.match(/\b(?:weather|forecast|temperature|rain|storm|wind|humidity)\b[^.?!]*?\b(?:in|for|at|near)\s+([a-zA-Z][a-zA-Z .'-]{2,80})/i)
    || raw.match(/\b(?:in|for|at|near)\s+([a-zA-Z][a-zA-Z .'-]{2,80})\s+(?:weather|forecast|temperature|rain|storm|wind|humidity)\b/i);
  if (!match?.[1]) return "";
  let location = match[1].replace(/\b(today|tomorrow|tonight|right now|now|please|dude|bro|man)\b.*$/i, "").trim();
  location = location.replace(/[?.!,;:]+$/g, "").trim();
  if (!location || /^(here|local|outside|there)$/i.test(location)) return "";
  if (/^st\.?\s*louis$/i.test(location)) return "St. Louis, Missouri";
  return location;
}

function isDefaultMemphisZooLocation(location = "") {
  const value = String(location || "").toLowerCase();
  return !value || value.includes("memphis zoo") || value === "memphis, tennessee" || value === "memphis";
}

export function inferWeatherLocation(text = "", threadContext = {}) {
  if (!isWeatherQuestion(text) && threadContext?.last_subject_type !== "weather") return "";
  const explicit = extractExplicitWeatherLocation(text);
  if (explicit) return mentionsMemphisPlace(explicit) ? DEFAULT_WEATHER_LOCATION : explicit;
  if (mentionsMemphisPlace(text)) return DEFAULT_WEATHER_LOCATION;
  if (threadContext?.context_json?.weather_location) return String(threadContext.context_json.weather_location || "");
  return DEFAULT_WEATHER_LOCATION;
}

export function augmentWeatherPrompt(userMessage = "", threadContext = {}) {
  const location = inferWeatherLocation(userMessage, threadContext);
  if (!location) return userMessage;
  return `${String(userMessage || "").trim()}\n\nWeather location context: ${location}. If the user says \"here\" or asks weather without another city, use ${location}.`;
}

function cToF(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round((n * 9 / 5) + 32);
}

function kmhToMph(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 0.621371);
}

// LOW #7: Weather attribution text is configurable via env var.
const WEATHER_ATTRIBUTION_ENABLED = String(process.env.MEMPHIS_WEATHER_ATTRIBUTION || "true").trim().toLowerCase() !== "false";

export function summarizeWeatherPayload(weather, defaultLocation = DEFAULT_WEATHER_LOCATION) {
  if (!weather) return `I could not pull live weather for ${defaultLocation} right now.`;
  const tempF = cToF(weather.temperature_c);
  const highF = cToF(weather.high_c);
  const lowF = cToF(weather.low_c);
  const windMph = kmhToMph(weather.wind_kmh);
  const temp = tempF == null ? "temperature unavailable" : `${tempF}°F`;
  const wind = windMph == null ? "wind unavailable" : `${windMph} mph wind`;
  const high = highF == null ? "high unavailable" : `high ${highF}°F`;
  const low = lowF == null ? "low unavailable" : `low ${lowF}°F`;
  const precip = weather.precipitation_probability == null ? "precipitation unknown" : `${Math.round(Number(weather.precipitation_probability))}% chance of precipitation`;
  const condition = weather.condition || "conditions unavailable";
  // LOW #7: Attribution text only included when enabled.
  const attribution = WEATHER_ATTRIBUTION_ENABLED
    ? (weather.observation_time ? ` Source: Open-Meteo, updated ${weather.observation_time}.` : " Source: Open-Meteo.")
    : "";
  return `${weather.location || defaultLocation}: ${condition}, ${temp}. Today: ${high}, ${low}, ${wind}, ${precip}.${attribution}`;
}

export async function fetchWeatherForMemphisTn(location = DEFAULT_WEATHER_LOCATION) {
  let resolvedLocation = location || DEFAULT_WEATHER_LOCATION;
  let latitude = MEMPHIS_ZOO_LATITUDE;
  let longitude = MEMPHIS_ZOO_LONGITUDE;
  let timezone = "America%2FChicago";

  if (!isDefaultMemphisZooLocation(resolvedLocation)) {
    // MEDIUM #11: Add country filter to geocoding to verify results are in the US.
    const geoRes = await weatherFetchWithTimeout(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(resolvedLocation)}&count=1&language=en&format=json&countryCode=US`);
    const geo = await geoRes.json().catch(() => null);
    const first = geo?.results?.[0];
    if (!geoRes.ok || !first?.latitude || !first?.longitude) throw new Error("Weather geocoding failed");
    // MEDIUM #11: Verify result is in the US.
    if (first.country_code && String(first.country_code).toUpperCase() !== "US") {
      throw new Error(`Weather geocoding returned a non-US result: ${first.name}, ${first.country || first.country_code}`);
    }
    latitude = first.latitude;
    longitude = first.longitude;
    timezone = encodeURIComponent(first.timezone || "auto");
    resolvedLocation = [first.name, first.admin1, first.country].filter(Boolean).join(", ");
  }

  // MEDIUM #10: Use weatherFetchWithTimeout for forecast API calls.
  const forecastRes = await weatherFetchWithTimeout(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=${timezone}&forecast_days=1`);
  const forecast = await forecastRes.json().catch(() => null);
  if (!forecastRes.ok || !forecast?.current || !forecast?.daily) throw new Error("Weather forecast failed");
  return {
    location: resolvedLocation,
    latitude,
    longitude,
    temperature_c: forecast.current.temperature_2m,
    wind_kmh: forecast.current.wind_speed_10m,
    high_c: forecast.daily.temperature_2m_max?.[0],
    low_c: forecast.daily.temperature_2m_min?.[0],
    precipitation_probability: forecast.daily.precipitation_probability_max?.[0],
    observation_time: forecast.current.time || "",
    condition: weatherCodeToText(forecast.current.weather_code),
  };
}

function weatherCodeToText(code) {
  const value = Number(code);
  if (value === 0) return "clear";
  if ([1, 2, 3].includes(value)) return "partly cloudy";
  if ([45, 48].includes(value)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(value)) return "drizzle";
  if ([61, 63, 65, 66, 67].includes(value)) return "rain";
  if ([71, 73, 75, 77].includes(value)) return "snow";
  if ([80, 81, 82].includes(value)) return "rain showers";
  if ([85, 86].includes(value)) return "snow showers";
  if ([95, 96, 99].includes(value)) return "thunderstorms";
  return "mixed conditions";
}
