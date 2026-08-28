#!/usr/bin/env node

import { createHmac } from "node:crypto";

const secret = String(process.env.REHEARSAL_JWT_SECRET || "");
if (secret.length < 32) throw new Error("REHEARSAL_JWT_SECRET must contain at least 32 characters.");
const encode = (value) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const header = encode({ alg: "HS256", typ: "JWT" });
const payload = encode({ role: "service_role", iss: "supabase", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 });
const unsigned = `${header}.${payload}`;
const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
process.stdout.write(`${unsigned}.${signature}`);
