import { z } from "zod";

export const optionalString = z.string().optional();
export const positiveInt = z.number().int().positive();
export const dryRun = z.boolean().optional();

const GITHUB_CONTENT_API_MAX_BYTES = 100_000_000;
const GITHUB_STABLE_BATCH_MAX_FILES = 500;
const GITHUB_STABLE_LIST_MAX_ENTRIES = 100_000;
const GITHUB_STABLE_REPLACE_MANY_MAX_PATCHES = 5_000;
const SUPABASE_SQL_READ_MAX_ROWS = 250_000;
const SUPABASE_SQL_READ_MAX_RESPONSE_BYTES = 100_000_000;

export const pingInputSchema = {
  message: z.string().optional(),
};

export const serverToolManifestInputSchema = {
  include_planned: z.boolean().optional(),
};

export const serverDeepHealthInputSchema = {
  strict_env: z.boolean().optional(),
};

export const githubDebugConfigInputSchema = {
  include_manifest: z.boolean().optional(),
};

export const githubListDirectoryInputSchema = {
  repo: optionalString,
  path: optionalString,
  ref: optionalString,
  recursive: z.boolean().optional(),
  max_entries: positiveInt.max(GITHUB_STABLE_LIST_MAX_ENTRIES).optional(),
};

export const githubRepoTreeInputSchema = {
  repo: optionalString,
  path: optionalString,
  ref: optionalString,
  max_entries: positiveInt.max(GITHUB_STABLE_LIST_MAX_ENTRIES).optional(),
};

export const githubReadFileInputSchema = {
  repo: optionalString,
  path: optionalString,
  paths: z.array(z.string().min(1)).min(1).max(GITHUB_STABLE_BATCH_MAX_FILES).optional(),
  ref: optionalString,
  format: z.enum(["text", "json", "base64"]).optional(),
  max_bytes: positiveInt.max(GITHUB_CONTENT_API_MAX_BYTES).optional(),
};

export const githubReadFileAtRefInputSchema = {
  repo: optionalString,
  path: z.string().min(1),
  ref: z.string().min(1),
  format: z.enum(["text", "json", "base64"]).optional(),
  max_bytes: positiveInt.max(GITHUB_CONTENT_API_MAX_BYTES).optional(),
};

export const githubBatchReadInputSchema = {
  repo: optionalString,
  paths: z.array(z.string().min(1)).min(1).max(GITHUB_STABLE_BATCH_MAX_FILES),
  ref: optionalString,
  format: z.enum(["json", "text", "base64"]).optional(),
  max_bytes: positiveInt.max(GITHUB_CONTENT_API_MAX_BYTES).optional(),
};

export const githubWriteFileInputSchema = {
  repo: optionalString,
  path: z.string().min(1),
  content: z.string(),
  commit_message: z.string().min(1),
  branch: optionalString,
  overwrite: z.boolean().optional(),
  dry_run: dryRun,
};

export const githubUpdateFileInputSchema = {
  repo: optionalString,
  path: z.string().min(1),
  content: z.string().optional(),
  find: z.string().optional(),
  replace: z.string().optional(),
  commit_message: z.string().min(1),
  branch: optionalString,
  expected_sha: optionalString,
  occurrence: z.enum(["first", "all"]).optional(),
  expected_matches: positiveInt.optional(),
  dry_run: dryRun,
};

export const githubReplaceTextInputSchema = {
  repo: optionalString,
  path: z.string().min(1),
  find: z.string().min(1),
  replace: z.string(),
  commit_message: z.string().min(1),
  branch: optionalString,
  expected_sha: optionalString,
  occurrence: z.enum(["first", "all"]).optional(),
  expected_matches: positiveInt.optional(),
  dry_run: dryRun,
};

export const githubRestoreFileFromRefInputSchema = {
  repo: optionalString,
  path: z.string().min(1),
  source_ref: z.string().min(1),
  commit_message: z.string().min(1),
  branch: optionalString,
  expected_sha: optionalString,
  dry_run: dryRun,
};

export const githubDeleteFileInputSchema = {
  repo: optionalString,
  path: z.string().min(1),
  commit_message: z.string().min(1),
  branch: optionalString,
  expected_sha: optionalString,
  dry_run: dryRun,
};

export const githubCommitStatusSummaryInputSchema = {
  repo: optionalString,
  path: optionalString,
  ref: optionalString,
  compare_ref: optionalString,
};

export const supabaseSqlReadInputSchema = {
  sql: z.string().min(1),
  max_rows: positiveInt.max(SUPABASE_SQL_READ_MAX_ROWS).optional(),
  max_response_bytes: positiveInt.max(SUPABASE_SQL_READ_MAX_RESPONSE_BYTES).optional(),
};

export const supabaseMigrationApplyInputSchema = {
  name: z.string().min(1),
  sql: z.string().min(1),
  dry_run: dryRun,
  allow_large: z.boolean().optional(),
};

export const githubReplaceManyCompatibilityLimits = {
  max_patches: GITHUB_STABLE_REPLACE_MANY_MAX_PATCHES,
};
