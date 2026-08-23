import { spawn } from "node:child_process";

const nested = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
process.send({ type: "ready", evidence: { fixture: true, nestedPid: nested.pid } });
process.on("message", (message) => {
  if (message?.type !== "compile") return;
  if (message.input?.behavior === "crash") process.exit(91);
  if (message.input?.behavior === "hang") return;
  const delay = Number(message.input?.delay || 0);
  const started = performance.now();
  while (performance.now() - started < delay) {}
  process.send({ type: "result", id: message.id, result: { ok: true, value: message.input?.value ?? null } });
});
