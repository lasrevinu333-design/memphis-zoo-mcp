function splitLines(text) {
  return String(text ?? "").replace(/\r/g, "").split("\n");
}

export function summarizeTextDiff(oldText, newText) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  let samePrefix = 0;

  while (
    samePrefix < oldLines.length &&
    samePrefix < newLines.length &&
    oldLines[samePrefix] === newLines[samePrefix]
  ) {
    samePrefix += 1;
  }

  let sameSuffix = 0;
  while (
    sameSuffix + samePrefix < oldLines.length &&
    sameSuffix + samePrefix < newLines.length &&
    oldLines[oldLines.length - 1 - sameSuffix] === newLines[newLines.length - 1 - sameSuffix]
  ) {
    sameSuffix += 1;
  }

  const removed = Math.max(0, oldLines.length - samePrefix - sameSuffix);
  const added = Math.max(0, newLines.length - samePrefix - sameSuffix);

  return {
    changed: oldText !== newText,
    old_line_count: oldLines.length,
    new_line_count: newLines.length,
    same_prefix_lines: samePrefix,
    same_suffix_lines: sameSuffix,
    lines_removed: removed,
    lines_added: added,
  };
}

export function makeUnifiedDiff({ oldText, newText, path = "file", context = 3 }) {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  if (oldText === newText) {
    return `--- a/${path}\n+++ b/${path}\n`; 
  }

  const summary = summarizeTextDiff(oldText, newText);
  const start = Math.max(0, summary.same_prefix_lines - context);
  const oldEnd = Math.min(oldLines.length, oldLines.length - summary.same_suffix_lines + context);
  const newEnd = Math.min(newLines.length, newLines.length - summary.same_suffix_lines + context);

  const output = [`--- a/${path}`, `+++ b/${path}`];
  output.push(
    `@@ -${start + 1},${Math.max(0, oldEnd - start)} +${start + 1},${Math.max(0, newEnd - start)} @@`
  );

  for (let i = start; i < summary.same_prefix_lines; i += 1) {
    output.push(` ${oldLines[i] ?? ""}`);
  }

  for (let i = summary.same_prefix_lines; i < oldLines.length - summary.same_suffix_lines; i += 1) {
    output.push(`-${oldLines[i] ?? ""}`);
  }

  for (let i = summary.same_prefix_lines; i < newLines.length - summary.same_suffix_lines; i += 1) {
    output.push(`+${newLines[i] ?? ""}`);
  }

  for (let i = newLines.length - summary.same_suffix_lines; i < newEnd; i += 1) {
    if (i >= start && i >= 0 && i < newLines.length) output.push(` ${newLines[i] ?? ""}`);
  }

  return `${output.join("\n")}\n`;
}
