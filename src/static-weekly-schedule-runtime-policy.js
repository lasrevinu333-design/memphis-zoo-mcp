// One source of truth for the fused production compute envelope. The parent
// uses these limits to launch the isolate and the child independently verifies
// the same limits before loading pinned HiGHS.
export const STATIC_WEEKLY_FUSED_COMPILER_RESOURCE_LIMITS = Object.freeze({
  maxOldGenerationSizeMb: 128,
  maxSemiSpaceSizeMb: 8,
  maxWasmMemoryMb: 96,
  stackSizeKb: 4 * 1024,
});
