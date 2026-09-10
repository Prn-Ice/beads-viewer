#!/usr/bin/env node
// Fake cloudflared for tests: prints a quick-tunnel banner with a fixed
// trycloudflare.com URL, then idles until killed (SIGTERM).
// Env: FAKE_CLOUDFLARED_URL overrides the URL; FAKE_CLOUDFLARED_FAIL=1 exits
// immediately with an error instead.

const url =
  process.env.FAKE_CLOUDFLARED_URL ?? "https://fake-tunnel-abc123.trycloudflare.com";

if (process.env.FAKE_CLOUDFLARED_FAIL) {
  console.error("ERR Failed to dial the edge, quitting.");
  process.exit(1);
}

console.error("Please take note of the following details:");
console.error("Requesting new quick Tunnel on trycloudflare.com...");
console.error(
  "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):",
);
console.error(`  ${url}`);
console.error("connectorId: 8f4c2a1b");
console.error("Registered tunnel connection connIndex=0");

process.on("SIGTERM", () => process.exit(0));
setInterval(() => {}, 1_000);
