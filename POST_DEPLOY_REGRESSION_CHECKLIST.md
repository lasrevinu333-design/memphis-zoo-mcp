# Post Deploy Regression Checklist

- Public protected write routes reject missing/bogus auth before validation.

## Moxie status

- The Moxie administration routes and runtime source are retired. A `404` remains the expected route outcome; this checklist does not authorize remounting them.
- Preserve protected historical data and the existing OAuth credential hook used by other supported services. Retirement is not data deletion or permission relaxation.
