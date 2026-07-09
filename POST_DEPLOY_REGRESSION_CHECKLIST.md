# Post Deploy Regression Checklist

- Public protected write routes reject missing/bogus auth before validation.

## Moxie status

- Moxie source exists under `src/routes/moxie.js`, but it is intentionally not mounted in the current running server.
- `/moxie/health` returning `404` is expected unless Moxie is explicitly mounted in `src/index.js`.
- If Moxie is mounted later, all write/admin/private routes must remain protected by Moxie's password/session middleware and should be re-smoked locally and on Render.
