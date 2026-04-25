# GitHub JSON Commands

The external MCP wrapper may continue to display the older tool schemas. The server supports additional GitHub operations through JSON commands placed in existing visible tool fields.

## Batch read

Use `github_read_file` with `path` set to a comma-separated batch command:

```json
{
  "path": "batch:README.md,package.json",
  "format": "json"
}
```

## Tool manifest

Use `github_read_file` with:

```json
{
  "path": "__manifest__",
  "format": "json"
}
```

## Text replacement preview

Use `github_update_file` with a JSON command inside `content`:

```json
{
  "path": "README.md",
  "content": "{\"op\":\"replace_text\",\"find\":\"old text\",\"replace\":\"new text\",\"expected_sha\":\"CURRENT_SHA\",\"dry_run\":true}",
  "commit_message": "Preview text replacement"
}
```

Set `dry_run` to `false` inside the JSON command only when ready to apply.

## Branch creation preview

Use `github_write_file` with a JSON command inside `content`:

```json
{
  "path": "rebuild/example-branch",
  "content": "{\"op\":\"create_branch\",\"new_branch\":\"rebuild/example-branch\",\"from_branch\":\"main\",\"dry_run\":true}",
  "commit_message": "Preview branch creation"
}
```

Set `dry_run` to `false` inside the JSON command only when ready to create the branch.

## Pull request preview

Use `github_write_file` with a JSON command inside `content`:

```json
{
  "path": "rebuild/example-branch",
  "content": "{\"op\":\"open_pr\",\"title\":\"Example PR\",\"head\":\"rebuild/example-branch\",\"base\":\"main\",\"body\":\"PR body\",\"draft\":true,\"dry_run\":true}",
  "commit_message": "Preview pull request"
}
```

Set `dry_run` to `false` inside the JSON command only when ready to open the pull request.

## Safety notes

- Keep `dry_run: true` until the preview looks correct.
- Prefer branch and PR workflow for large changes.
- Direct `main` updates should stay small and reversible.
- Use SHA checks for file updates.
