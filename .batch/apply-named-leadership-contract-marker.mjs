import { readFile, writeFile } from 'node:fs/promises';
const path = 'src/index.js';
const source = await readFile(path, 'utf8');
const oldText = 'const OPS_MANAGER_AUTH_CONTRACT_VERSION = "ops-manager-auth.v4.shared-48h";';
const newText = 'const OPS_MANAGER_AUTH_CONTRACT_VERSION = "ops-manager-auth.v5.named-leadership";';
if (!source.includes(oldText)) throw new Error('Retired shared enrollment contract marker was not found.');
await writeFile(path, source.replace(oldText, newText));
console.log('Prepared named leadership auth contract marker.');
