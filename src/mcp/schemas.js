import { z } from "zod";

export const optionalString = z.string().optional();
export const positiveInt = z.number().int().positive();
export const dryRun = z.boolean().optional();

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
  max_entries: positiveInt.max(10000).optional(),
};

export const githubRepoTreeInputSchema = {
  repo: optionalString,
  path: optionalString,
  ref: optionalString,
  max_entries: positiveInt.max(10000).optional(),
};

export const githubReadFileInputSchema = {
  repo: optionalString,
  path: optionalString,
  paths: z.array(z.string().min(1)).min(1).max(25).optional(),
  ref: optionalString,
  format: z.enum(["text", "json", "base64"]).optional(),
  max_bytes: positiveInt.max(10_000_000).optional(),
};

export const githubBatchReadInputSchema = {
  repo: optionalString,
  paths: z.array(z.string().min(1)).min(1).max(25),
  ref: optionalString,
  format: z.enum(["json", "text", "base64"]).optional(),
  max_bytes: positiveInt.max(10_000_000).optional(),
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
  expected_sha: z.string().min(1),
  occurrence: z.enum(["first", "all"]).optional(),
  expected_matches: positiveInt.optional(),
  dry_run: dryRun,
};

export const supabaseSqlReadInputSchema = {
  sql: z.string().min(1),
};

export const supabaseMigrationApplyInputSchema = {
  name: z.string().min(1),
  sql: z.string().min(1),
  dry_run: dryRun,
};
