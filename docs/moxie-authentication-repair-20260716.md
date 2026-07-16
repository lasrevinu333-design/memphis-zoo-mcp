# Moxie authentication repair — 2026-07-16

Release contract: `release-2026.07.16.manager-access-repair.1`

- Production Moxie always requires authentication.
- The password field starts empty, remains masked, and is not embedded in page source.
- Logout clears the scoped session cookie and protected pages are not cached.
- The intended high-resolution shortcut artwork is served from the Moxie asset path without generic overlay glyphs.
- Moxie returns explicitly to the full-access Ops Manager Hub.
