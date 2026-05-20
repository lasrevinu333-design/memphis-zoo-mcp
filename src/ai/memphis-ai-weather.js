export const DEFAULT_WEATHER_LOCATION = "Memphis Zoo, Memphis, Tennessee";
const MEMPHIS_ZOO_LATITUDE = 35.1506;
const MEMPHIS_ZOO_LONGITUDE = -89.9944;

export function isWeatherQuestion(text = "") {
  return /\b(weather|forecast|temperature|rain|storm|sunny|cloudy|wind|humid|humidity)\b/i.test(String(text || ""));
}

export function mentionsMemphisPlace(text = "") {
  return /\bmemphis\b/i.test(String(text || ""));
}

export function inferWeatherLocation(text = "", threadContext = {}) {
  if (!isWeatherQuestion(text) && threadContext?.last_subject_type !== "weather") return "";
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
  const observed = weather.observation_time ? ` Source: Open-Meteo, updated ${weather.observation_time}.` : " Source: Open-Meteo.";
  return `${weather.location || defaultLocation}: ${condition}, ${temp}. Today: ${high}, ${low}, ${wind}, ${precip}.${observed}`;
}

export async function fetchWeatherForMemphisTn(location = DEFAULT_WEATHER_LOCATION) {
  const forecastRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(MEMPHIS_ZOO_LATITUDE)}&longitude=${encodeURIComponent(MEMPHIS_ZOO_LONGITUDE)}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FChicago&forecast_days=1`);
  const forecast = await forecastRes.json().catch(() => null);
  if (!forecastRes.ok || !forecast?.current || !forecast?.daily) throw new Error("Weather forecast failed");
  return {
    location,
    latitude: MEMPHIS_ZOO_LATITUDE,
    longitude: MEMPHIS_ZOO_LONGITUDE,
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
