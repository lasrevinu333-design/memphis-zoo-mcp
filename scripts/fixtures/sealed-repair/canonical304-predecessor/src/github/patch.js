import { makeUnifiedDiff, summarizeTextDiff } from "../utils/diff.js";

function countOccurrences(text, find) {
  if (!find) return 0;
  return String(text).split(String(find)).length - 1;
}

export function previewTextReplacement({
  oldText,
  find,
  replace,
  path = "file",
  occurrence = "first",
  expectedMatches,
  context = 3,
} = {}) {
  const source = String(oldText ?? "");
  const needle = String(find ?? "");
  const replacement = String(replace ?? "");

  if (!needle) throw new Error("find text is required.");
  if (!['first', 'all'].includes(occurrence)) {
    throw new Error('occurrence must be "first" or "all".');
  }

  const matches = countOccurrences(source, needle);
  if (matches === 0) {
    throw new Error("find text was not found.");
  }

  if (expectedMatches != null && Number(expectedMatches) !== matches) {
    throw new Error(`Expected ${expectedMatches} match(es), found ${matches}.`);
  }

  const newText = occurrence === "all"
    ? source.split(needle).join(replacement)
    : source.replace(needle, replacement);

  return {
    ok: true,
    changed: source !== newText,
    path,
    occurrence,
    matches,
    applied_matches: occurrence === "all" ? matches : 1,
    summary: summarizeTextDiff(source, newText),
    diff: makeUnifiedDiff({ oldText: source, newText, path, context }),
    newText,
  };
}

export function previewFullReplacement({ oldText, newText, path = "file", context = 3 } = {}) {
  const source = String(oldText ?? "");
  const target = String(newText ?? "");

  return {
    ok: true,
    changed: source !== target,
    path,
    summary: summarizeTextDiff(source, target),
    diff: makeUnifiedDiff({ oldText: source, newText: target, path, context }),
    newText: target,
  };
}
