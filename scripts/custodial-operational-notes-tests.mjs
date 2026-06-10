import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const migrationDir = path.resolve("sql");
const sql = fs
  .readdirSync(migrationDir)
  .filter((file) => file.endsWith(".sql"))
  .sort()
  .map((file) => fs.readFileSync(path.join(migrationDir, file), "utf8"))
  .join("\n\n");

const requiredRuleCodes = [
  "balance_primary",
  "no_same_lunch_relief",
  "michael_device_call_coverage",
  "printouts_static_timeless",
  "printouts_restrooms_first",
  "gift_shops_monday_reminders_only",
  "primate_canyon_cat_country_response_only",
  "herpetarium_no_wednesday",
  "alijah_herpetarium_restriction",
  "kinnaye_route",
  "karen_route",
  "tammy_route",
  "kathy_route",
  "kathy_east_boundary",
  "preserve_primate_pavillion_key",
];
for (const ruleCode of requiredRuleCodes) {
  assert.match(sql, new RegExp(`'${ruleCode}'`), `missing operational note ${ruleCode}`);
}

assert.match(sql, /create table if not exists public\.schedule_operational_notes/i, "operational notes table must be created");
assert.match(sql, /sch_validate_operational_schedule_rules/i, "validation function must be included");
assert.match(sql, /sch_guard_operational_coverage_template/i, "coverage template guard must be included");
assert.match(sql, /sch_guard_operational_daily_assignment/i, "daily assignment guard must be included");
assert.match(sql, /coalesce\(dsa\.coverage_purpose, ''\) not in \('lunch_coverage', 'reminder', 'response_only'\)/i, "lunch coverage must skip reminder and response-only rows");
assert.match(sql, /lg\.group_code = 'HERPETARIUM'[\s\S]*ct\.day_of_week = 3/i, "Herpetarium Wednesday guard/validation must be present");
assert.match(sql, /lg\.group_code like '%GIFT_SHOP'[\s\S]*ct\.coverage_start = time '08:00'/i, "gift shops must be Monday 8am reminder-only");
assert.match(sql, /PRIMATE_CANYON[\s\S]*CAT_COUNTRY[\s\S]*response_only/i, "Primate Canyon/Cat Country response-only policy must be present");
assert.match(sql, /PRIMATE_PAVILLION/i, "must preserve PRIMATE_PAVILLION key spelling");
assert.match(sql, /Alijah Collins[\s\S]*HERPETARIUM[\s\S]*restricted/i, "Alijah Herpetarium restriction must be seeded");
assert.match(sql, /Karen Robinson[\s\S]*ZAMBEZI[\s\S]*PRIMATE_PAVILLION/i, "Karen route preferences must be seeded");
assert.match(sql, /Tammy Miller[\s\S]*TETON[\s\S]*NORTH_WEST_PASSAGE/i, "Tammy route preferences must be seeded");
assert.match(sql, /Kinnaye Peete[\s\S]*ELEPHANT_TRUNK_GIFT_SHOP/i, "Kinnaye Monday gift-shop reminder preference must be seeded");
assert.match(sql, /Kathy Phelps[\s\S]*MEMMEX_RESTROOMS/i, "Kathy west route preferences must be seeded");
assert.match(sql, /kathy_east_boundary/i, "Kathy east-boundary policy must be represented");
assert.match(sql, /Kathy Phelps[\s\S]*HERPETARIUM[\s\S]*restricted/i, "Kathy Herpetarium/east-boundary restriction must be seeded");
assert.match(sql, /sch_validate_kathy_east_boundary/i, "Kathy east-boundary validation function must be included");
assert.match(sql, /TROPICAL_BIRDS[\s\S]*avoid/i, "Tropical Birds must be Kathy's farthest allowed stretch/avoid area, not an east-side assignment pass-through");
assert.doesNotMatch(sql, /sch_upsert_employee_area_preference_by_code\([^;]*'last_resort'/i, "seeded employee preference rows must use the live prefer/avoid/restricted type contract, not last_resort as a preference_type");

console.log(JSON.stringify({ ok: true, custodial_operational_notes_policy_tests: "passed" }, null, 2));
