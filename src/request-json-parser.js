import express from 'express';

// Shared production mount: scan authority and OAuth registration retain their
// existing dedicated parser/limit/error-order contracts.
export function createGeneralJsonMiddleware() {
  const parser = express.json({limit: '10mb'});
  const dedicatedPath = /^\/(?:scan-api\/rpc|oauth\/register)\/?$/i;
  // Express route parameters consume one path segment, with optional trailing
  // slash and case-insensitive routing by default. Preserve the ORIGINAL bytes
  // only for the two typed, fully attested native legacy POST endpoints.
  const legacyPath = /^\/custodial-device-auth\/assigned-activation-operations\/[^/]+\/(?:legacy-lineage-binding|native-legacy-result)\/?$/i;
  const legacyParser = express.json({
    limit: 2048,
    verify(req, _res, bytes) { req.scanAuthorityRawBody = Buffer.from(bytes); },
  });
  return (req, res, next) => {
    if (dedicatedPath.test(req.path)) return next();
    if (req.method === 'POST' && legacyPath.test(req.path)) return legacyParser(req, res, next);
    return parser(req, res, next);
  };
}
