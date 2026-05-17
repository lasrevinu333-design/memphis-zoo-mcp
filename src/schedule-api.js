import express from "express";

export function createScheduleRouter({ buildHealthPayload, appVersion, releaseId, contractVersion }) {
  const router = express.Router();
  router.get("/health", (_req, res) => {
    res.status(200).json(buildHealthPayload("schedule", { contract_version: contractVersion, emergency_repair: true }));
  });
  router.use((_req, res) => {
    res.status(503).json({ ok: false, error: "Schedule API is temporarily disabled for emergency repair.", meta: { version: appVersion, release_id: releaseId, contract_version: contractVersion } });
  });
  return router;
}
