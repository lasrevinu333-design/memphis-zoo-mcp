import { esc, normalizeLoose } from "./memphis-ai-utils.js";

function isContactQuestion(text = "") {
  const lower = normalizeLoose(text);
  if (!lower) return false;

  return /\b(who is|who's|contact|phone|number|manager|boss|director|ops manager|operations manager|custodial manager|horticulture manager|water quality|facilities manager)\b/.test(lower)
    || /\b(eric|operle|brandy|gull|haley|lejman|jennifer|sheffield)\b/.test(lower);
}

function contactWhereClause(text = "") {
  const lower = normalizeLoose(text);
  const terms = [];

  if (/\beric\b|\boperle\b/.test(lower)) terms.push("Eric");
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

function summarizeContact(contact) {
  const parts = [`${contact.display_name}: ${contact.role_title}`];
  if (contact.department) parts.push(contact.department);
  if (contact.phone) parts.push(`phone ${contact.phone}`);
  if (contact.notes) parts.push(contact.notes);
  return parts.join(". ") + ".";
}

export async function answerInternalContactQuestion(runReadOnlySql, text = "") {
  if (!isContactQuestion(text)) return null;

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

  return contacts.map(summarizeContact).join(" ");
}
