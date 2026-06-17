#!/usr/bin/env node
/**
 * Migrate Annie's Log data from local JSON files to Supabase.
 * Run once during deployment.
 *
 * Usage:
 *   node migrate-annie-log.js
 *
 * Requires env vars:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   ANNIE_DATA_DIR (optional, defaults to /home/eric/.hermes/profiles/annie/data)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import crypto from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATA_DIR = process.env.ANNIE_DATA_DIR || "/home/eric/.hermes/profiles/annie/data";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function readJson(filename) {
  const path = `${DATA_DIR}/${filename}`;
  if (!existsSync(path)) {
    console.log(`  ${filename}: not found, skipping`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`  ${filename}: parse error: ${err.message}`);
    return null;
  }
}

function hexId() {
  return crypto.randomBytes(6).toString("hex");
}

async function main() {
  console.log("=== Annie's Log Migration ===\n");

  // 1. Apply SQL migration
  console.log("Step 1: Applying SQL migration...");
  const sqlPath = new URL("../supabase/migrations/005_annie_log.sql", import.meta.url).pathname;
  if (existsSync(sqlPath)) {
    console.log(`  SQL file: ${sqlPath}`);
    console.log("  NOTE: Run this SQL manually in Supabase SQL Editor or via the Supabase CLI.");
    console.log("  The tables use RLS with service-role bypass, so no additional grants needed.");
  }

  // 2. Migrate notes
  console.log("\nStep 2: Migrating notes...");
  const logData = readJson("annies_log.json");
  if (logData?.notes?.length) {
    for (const note of logData.notes) {
      const id = note.id || hexId();
      const { error } = await supabase.from("annie_log_notes").upsert({
        id,
        content: note.content || "",
        created_at: note.created_at || new Date().toISOString(),
        updated_at: note.updated_at || note.created_at || new Date().toISOString(),
      });
      if (error) {
        console.error(`  ERROR note ${id}: ${error.message}`);
      } else {
        console.log(`  Note ${id}: OK`);
      }
    }
  } else {
    console.log("  No notes to migrate.");
  }

  // 3. Migrate reminders
  console.log("\nStep 3: Migrating reminders...");
  if (logData?.reminders?.length) {
    for (const r of logData.reminders) {
      const id = r.id || hexId();
      const { error } = await supabase.from("annie_log_reminders").upsert({
        id,
        content: r.content || "",
        due: r.due || "",
        fingerprint: r.fingerprint || "",
        done: r.status === "done",
        done_at: r.completed_at || null,
        created_at: r.created_at || new Date().toISOString(),
        updated_at: r.updated_at || r.created_at || new Date().toISOString(),
      });
      if (error) {
        console.error(`  ERROR reminder ${id}: ${error.message}`);
      } else {
        console.log(`  Reminder ${id}: OK (done=${r.status === "done"})`);
      }
    }
  } else {
    console.log("  No reminders to migrate.");
  }

  // 4. Migrate suggested reminders
  console.log("\nStep 4: Migrating suggested reminders...");
  if (logData?.suggested_reminders?.length) {
    for (const s of logData.suggested_reminders) {
      const id = s.id || hexId();
      const { error } = await supabase.from("annie_log_suggested_reminders").upsert({
        id,
        content: s.content || "",
        due: s.due || "",
        fingerprint: s.fingerprint || "",
        status: s.status || "pending",
        created_at: s.created_at || new Date().toISOString(),
        updated_at: s.updated_at || s.created_at || new Date().toISOString(),
      });
      if (error) {
        console.error(`  ERROR suggested ${id}: ${error.message}`);
      } else {
        console.log(`  Suggested reminder ${id}: OK`);
      }
    }
  } else {
    console.log("  No suggested reminders to migrate.");
  }

  // 5. Migrate contacts
  console.log("\nStep 5: Migrating contacts...");
  const contactsData = readJson("annie_contacts.json");
  if (contactsData?.contacts?.length) {
    for (const c of contactsData.contacts) {
      const id = c.id || hexId();
      const { error } = await supabase.from("annie_contacts").upsert({
        id,
        name: c.full_name || "",
        phone: c.phone || "",
        email: c.email || "",
        notes: c.notes || "",
        source: c.source === "manual" ? "manual" : "manual",
        created_at: c.created_at || new Date().toISOString(),
        updated_at: c.updated_at || c.created_at || new Date().toISOString(),
      });
      if (error) {
        console.error(`  ERROR contact ${id}: ${error.message}`);
      } else {
        console.log(`  Contact ${id} (${c.full_name}): OK`);
      }
    }
  } else {
    console.log("  No contacts to migrate.");
  }

  // 6. Migrate suggested contacts
  console.log("\nStep 6: Migrating suggested contacts...");
  if (contactsData?.suggested_contacts?.length) {
    for (const s of contactsData.suggested_contacts) {
      const id = s.id || hexId();
      const { error } = await supabase.from("annie_suggested_contacts").upsert({
        id,
        name: s.full_name || "",
        phone: s.phone || "",
        email: s.email || "",
        notes: s.notes || "",
        status: s.status || "pending",
        created_at: s.created_at || new Date().toISOString(),
        updated_at: s.updated_at || s.created_at || new Date().toISOString(),
      });
      if (error) {
        console.error(`  ERROR suggested contact ${id}: ${error.message}`);
      } else {
        console.log(`  Suggested contact ${id}: OK`);
      }
    }
  } else {
    console.log("  No suggested contacts to migrate.");
  }

  // 7. Migrate chat state
  console.log("\nStep 7: Migrating chat state...");
  const chatState = readJson("annie_chat_state.json");
  if (chatState) {
    const history = Array.isArray(chatState.history) ? chatState.history : [];
    const savedChats = Array.isArray(chatState.savedChats) ? chatState.savedChats : [];
    const { error } = await supabase.from("annie_chat_state").upsert({
      id: "default",
      history,
      saved_chats: savedChats,
      updated_at: chatState.updatedAt || new Date().toISOString(),
    });
    if (error) {
      console.error(`  ERROR chat state: ${error.message}`);
    } else {
      console.log(`  Chat state: OK (${history.length} msgs, ${savedChats.length} saved)`);
    }
  } else {
    console.log("  No chat state to migrate.");
  }

  console.log("\n=== Migration complete ===");
}

main().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});
