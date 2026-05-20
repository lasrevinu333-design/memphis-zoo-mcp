import { esc } from "./memphis-ai-utils.js";

export function normalizeEmployeeMatchText(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function levenshteinDistance(a = "", b = "") {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    for (let j = 0; j <= right.length; j += 1) previous[j] = current[j];
  }

  return previous[right.length];
}

export function employeeTokenMatchScore(queryToken = "", nameToken = "") {
  const query = normalizeEmployeeMatchText(queryToken);
  const name = normalizeEmployeeMatchText(nameToken);
  if (!query || !name) return 0;
  if (query === name) return 40;
  if (query.length >= 3 && name.startsWith(query)) return 30;
  if (name.length >= 3 && query.startsWith(name)) return 28;
  if (query.length >= 4 && name.includes(query)) return 24;
  if (name.length >= 4 && query.includes(name)) return 22;

  const distance = levenshteinDistance(query, name);
  const maxLength = Math.max(query.length, name.length);
  if (maxLength >= 5 && distance <= 1) return 25;
  if (maxLength >= 7 && distance <= 2) return 18;
  return 0;
}

export function scoreEmployeeNameMatch(userText = "", displayName = "") {
  const query = normalizeEmployeeMatchText(userText);
  const name = normalizeEmployeeMatchText(displayName);
  if (!query || !name) return 0;
  if (query.includes(name)) return 1000 + name.length;

  const nameTokens = name.split(/\s+/).filter(Boolean);
  const queryTokens = query.split(/\s+/).filter(Boolean);
  let score = 0;

  for (const nameToken of nameTokens) {
    let bestTokenScore = 0;
    for (const queryToken of queryTokens) {
      bestTokenScore = Math.max(bestTokenScore, employeeTokenMatchScore(queryToken, nameToken));
    }
    score += bestTokenScore;
  }

  const firstName = nameTokens[0] || "";
  const lastName = nameTokens[nameTokens.length - 1] || "";
  if (firstName && queryTokens.some((token) => employeeTokenMatchScore(token, firstName) >= 18)) score += 80;
  if (lastName && queryTokens.some((token) => employeeTokenMatchScore(token, lastName) >= 22)) score += 40;

  return score;
}

export async function resolveEmployeeByLooseName(runReadOnlySql, employeeName = "") {
  const rawName = String(employeeName || "").trim();
  if (!rawName) return null;

  const rows = await runReadOnlySql(`
    select public.sch_resolve_employee_ref('${esc(rawName)}') as data
  `);
  const resolved = Array.isArray(rows) && rows.length ? rows[0].data : null;

  if (!resolved?.ok || !resolved.employee_id) return null;

  return {
    id: resolved.employee_id,
    display_name: resolved.employee_name,
    employee_code: resolved.employee_code,
    role: resolved.role,
    match_source: resolved.match_source,
    matched_text: resolved.matched_text,
    score: resolved.score,
  };
}

export async function guessEmployeeName(runRpc, text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const employees = await runRpc("tool_list_active_employees", {});
  const list = Array.isArray(employees) ? employees : [];
  let best = null;
  let bestScore = 0;

  for (const employee of list) {
    const name = String(employee.display_name || employee.employee_name || "").trim();
    if (!name) continue;
    const score = scoreEmployeeNameMatch(raw, name);
    if (score > bestScore) {
      best = name;
      bestScore = score;
    }
  }

  return bestScore >= 70 ? best : "";
}
