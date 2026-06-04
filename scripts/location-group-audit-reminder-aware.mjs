#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const CONFIG_PATH = path.resolve("config/location-classification.json");
const DEFAULT_BASE_URL = "https://memphis-zoo-mcp.onrender.com";
const SCAN_TRACKED_EMPTY = "ERROR_SCAN_TRACKED_EMPTY";
const OK_REMINDER_ONLY_EMPTY = "OK_REMINDER_ONLY_EMPTY";
const OK_REMINDER_ONLY_PRESENT = "OK_REMINDER_ONLY_PRESENT";
const OK_RESPONSE_ONLY_EMPTY = "OK_RESPONSE_ONLY_EMPTY";
const OK_RESPONSE_ONLY_PRESENT = "OK_RESPONSE_ONLY_PRESENT";
const OK_SCAN_TRACKED = "OK_SCAN_TRACKED";
const WARN_EMPTY_UNCLASSIFIED = "WARN_EMPTY_UNCLASSIFIED";
const OK_UNCLASSIFIED_PRESENT = "OK_UNCLASSIFIED_PRESENT";

function normalizeKey(value = "") {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function includedLocations(group = {}) {
  return Array.isArray(group.included_locations) ? group.included_locations.filter(Boolean) : [];
}

function groupCode(group = {}) {
  return group.group_code || group.location_group_code || group.code || "";
}

function buildClassificationIndex(classification = {}) {
  const index = new Map();
  for (const [key, value] of Object.entries(classification.groups || {})) {
    index.set(normalizeKey(key), { key, ...value });
  }
  return index;
}

function findClassification(group, index) {
  const normalizedGroupCode = normalizeKey(groupCode(group));
  return normalizedGroupCode ? index.get(normalizedGroupCode) || null : null;
}

async function readClassification() {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
}

async function fetchLocationGroups(baseUrl) {
  const url = new URL("/schedule-api/location-groups", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const response = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.data)) return payload.data;
  throw new Error(`GET ${url} did not return an array or { data: [] } payload`);
}

function isScanTracked(classification) {
  return classification?.nfc_scan_required === true
    || classification?.classification === "scan_tracked_daily"
    || classification?.kind === "nfc_scan_location";
}

function isResponseOnlyNoClean(classification) {
  return classification?.classification === "response_only_no_clean"
    || classification?.kind === "calls_to_location_only";
}

function classifyGroup(group, classification) {
  const included = includedLocations(group);
  const isEmpty = included.length === 0;
  if (isResponseOnlyNoClean(classification)) return isEmpty ? OK_RESPONSE_ONLY_EMPTY : OK_RESPONSE_ONLY_PRESENT;
  if (isEmpty && classification?.also_valid_empty === true) return OK_REMINDER_ONLY_EMPTY;
  if (isEmpty && classification?.nfc_scan_required === true) return SCAN_TRACKED_EMPTY;
  if (isEmpty && !classification) return WARN_EMPTY_UNCLASSIFIED;
  if (isScanTracked(classification) && !isEmpty) return OK_SCAN_TRACKED;
  if (classification?.classification === "schedule_reminder_only") return OK_REMINDER_ONLY_PRESENT;
  if (isEmpty) return WARN_EMPTY_UNCLASSIFIED;
  return OK_UNCLASSIFIED_PRESENT;
}

function printTable(rows) {
  const headers = ["status", "key", "group_code", "group_name", "included_count", "classification"];
  const widths = Object.fromEntries(headers.map((header) => [header, header.length]));
  for (const row of rows) {
    for (const header of headers) widths[header] = Math.max(widths[header], String(row[header] ?? "").length);
  }
  const line = headers.map((header) => String(header).padEnd(widths[header])).join("  ");
  console.log(line);
  console.log(headers.map((header) => "-".repeat(widths[header])).join("  "));
  for (const row of rows) {
    console.log(headers.map((header) => String(row[header] ?? "").padEnd(widths[header])).join("  "));
  }
}

function summarize(rows) {
  return rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const config = await readClassification();
  const baseUrl = process.env.BASE_URL || process.env.MEMPHIS_ZOO_BASE_URL || config.default_base_url || DEFAULT_BASE_URL;
  const classificationIndex = buildClassificationIndex(config);
  const groups = await fetchLocationGroups(baseUrl);
  const rows = groups.map((group) => {
    const classification = findClassification(group, classificationIndex);
    const included = includedLocations(group);
    return {
      status: classifyGroup(group, classification),
      key: classification?.key || "",
      group_code: groupCode(group),
      group_name: group.group_name || group.location_group_name || group.name || "",
      included_count: included.length,
      classification: classification?.classification || "unclassified",
    };
  });

  const seenClassifiedKeys = new Set(rows.map((row) => row.key).filter(Boolean));
  for (const [key, classification] of Object.entries(config.groups || {})) {
    if (isScanTracked(classification) && !seenClassifiedKeys.has(key)) {
      rows.push({
        status: SCAN_TRACKED_EMPTY,
        key,
        group_code: "",
        group_name: "",
        included_count: 0,
        classification: classification.classification,
      });
    } else if (isResponseOnlyNoClean(classification) && !seenClassifiedKeys.has(key)) {
      rows.push({
        status: OK_RESPONSE_ONLY_EMPTY,
        key,
        group_code: "",
        group_name: "",
        included_count: 0,
        classification: classification.classification,
      });
    }
  }

  rows.sort((a, b) => a.status.localeCompare(b.status) || a.key.localeCompare(b.key) || a.group_name.localeCompare(b.group_name));
  console.log(`Reminder-aware location group audit`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Fetched groups: ${groups.length}`);
  console.log("");
  printTable(rows);
  console.log("");
  console.log("Summary:");
  const counts = summarize(rows);
  for (const status of Object.keys(counts).sort()) console.log(`- ${status}: ${counts[status]}`);

  const errors = rows.filter((row) => row.status.startsWith("ERROR_"));
  if (errors.length) {
    console.error("");
    console.error(`Audit failed with ${errors.length} true error(s).`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Reminder-aware location group audit failed: ${error?.message || error}`);
  process.exitCode = 1;
});
