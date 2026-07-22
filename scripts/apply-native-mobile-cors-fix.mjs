import { readFile, writeFile } from 'node:fs/promises';

async function replaceExact(path, oldText, newText) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(oldText)) throw new Error(`${path}: expected source block not found`);
  const next = source.replace(oldText, newText);
  if (next === source) throw new Error(`${path}: replacement did not change file`);
  await writeFile(path, next);
}

await replaceExact(
  'src/index.js',
  `const DEFAULT_CORS_ORIGINS = [
  "https://memphis-zoo-mcp.onrender.com",
  "https://lasrevinu333-design.github.io",
  "https://nousresearch.github.io",
];`,
  `const DEFAULT_CORS_ORIGINS = [
  "https://memphis-zoo-mcp.onrender.com",
  "https://lasrevinu333-design.github.io",
  "https://nousresearch.github.io",
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
];`,
);

await replaceExact(
  'src/index.js',
  `  "X-Device-Credential",
  "X-Device-Security-CSRF",`,
  `  "X-Device-Credential",
  "X-Memphis-Device-Credential",
  "X-Device-Security-CSRF",`,
);

await replaceExact(
  'scripts/operations-leadership-mobile-contract-tests.mjs',
  `console.log("OPERATIONS_LEADERSHIP_MOBILE_CONTRACT_PASS");`,
  `for (const mobileOrigin of ["https://localhost", "http://localhost", "capacitor://localhost", "ionic://localhost"]) {
  assert.ok(indexSource.includes(\`"\${mobileOrigin}"\`), \`backend CORS must allow native app origin \${mobileOrigin}\`);
}
assert.match(indexSource, /X-Memphis-Device-Credential/);

console.log("OPERATIONS_LEADERSHIP_MOBILE_CONTRACT_PASS");`,
);

console.log('Applied native mobile CORS repair.');
