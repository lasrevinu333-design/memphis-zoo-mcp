import { esc, normalizeLoose } from "./memphis-ai-utils.js";

function isManagerRole(role = "") {
  return String(role || "").trim().toLowerCase() === "manager";
}

function isContactQuestion(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;

  const explicitContactIntent = /\b(contact|phone|number|call|text|reach|how do i reach|how can i reach)\b/.test(lower);
  const namedLookup = /\b(eric|operle|mckenneys?|mckinneys?|brandy|gull|haley|lejman|jennifer|sheffield)\b/.test(lower);
  const titledLookup = /\b(ops manager|operations manager|custodial manager|horticulture manager|water quality manager|facilities manager)\b/.test(lower) && /\b(who is|who's|contact|phone|number)\b/.test(lower);

  return explicitContactIntent || namedLookup || titledLookup;
}

function contactWhereClause(text = "") {
  const lower = normalizeLoose(text);
  const terms = [];

  if (/\bmckenneys?\b|\bmckinneys?\b/.test(lower)) terms.push("McKenney", "Facilities");
  else if (/\beric\b|\boperle\b/.test(lower)) terms.push("Eric");
  if (/\bbrandy\b|\bgull\b/.test(lower)) terms.push("Brandy", "Gull");
  if (/\bhaley\b|\blejman\b/.test(lower)) terms.push("Haley", "Lejman");
  if (/\bjennifer\b|\bsheffield\b|\bboss\b|\bdirector\b/.test(lower)) terms.push("Jennifer", "Sheffield", "Director");
  if (/\bfacilities\b/.test(lower)) terms.push("Facilities");
  if (/\bcustodial\b/.test(lower)) terms.push("Custodial");
  if (/\bhorticulture\b/.test(lower)) terms.push("Horticulture");
  if (/\bwater quality\b/.test(lower)) terms.push("Water Quality");

  if (!terms.length && /\b(manager|contact|phone|number|operations|ops)\b/.test(lower)) {
    return "active = true";
  }

  if (!terms.length) return "active = true";

  const filters = terms.map((term) => {
    const like = `'%${esc(term)}%'`;
    return `(display_name ilike ${like} or role_title ilike ${like} or coalesce(department, '') ilike ${like} or coalesce(notes, '') ilike ${like})`;
  });

  return `(${filters.join(" or ")})`;
}

function summarizeContact(contact, { includePhone = false } = {}) {
  const parts = [`${contact.display_name}: ${contact.role_title}`];
  if (contact.department) parts.push(contact.department);
  if (includePhone && contact.phone) parts.push(`phone ${contact.phone}`);
  if (contact.notes) parts.push(contact.notes);
  return parts.join(". ") + ".";
}

function isAmbiguousFirstNameOnly(text = "", firstName = "") {
  const lower = normalizeLoose(text);
  const name = normalizeLoose(firstName);
  if (!lower || !name) return false;
  if (lower.includes("operle") || lower.includes("facilities") || lower.includes("custodial")) return false;
  return new RegExp(`\\b${name}\\b`).test(lower);
}

function summarizeAmbiguousContacts(contacts = [], firstName = "") {
  const options = contacts.map((contact, index) => `${index + 1}. ${contact.display_name}, ${contact.role_title}${contact.department ? `, ${contact.department}` : ""}`);
  return `I found more than one ${firstName}. Which one do you mean? ${options.join("; ")}.`;
}

export async function answerInternalContactQuestion(runReadOnlySql, text = "", userRole = "") {
  if (!isContactQuestion(text)) return null;

  // H4: Phone numbers are only exposed to manager role.
  const phoneRequested = /\b(contact|phone|number|call|text|reach|how do i reach|how can i reach)\b/.test(normalizeLoose(text));
  const includePhone = phoneRequested && isManagerRole(userRole);
  const where = contactWhereClause(text);
  const rows = await runReadOnlySql(`
    select display_name, role_title, department, phone, notes, active, sort_order
    from public.internal_ops_contacts
    where ${where}
    order by active desc, sort_order asc, display_name asc
    limit 8
  `);

  const contacts = Array.isArray(rows) ? rows : [];
  if (!contacts.length) return null;

  if (isAmbiguousFirstNameOnly(text, "Eric")) {
    const erics = contacts.filter((contact) => normalizeLoose(contact.display_name).includes("eric"));
    if (erics.length > 1) return summarizeAmbiguousContacts(erics, "Eric");
  }

  return contacts.map((contact) => summarizeContact(contact, { includePhone })).join(" ");
}
