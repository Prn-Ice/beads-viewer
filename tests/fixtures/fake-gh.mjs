#!/usr/bin/env node
// Fake gh for tests: answers `gh auth token`.

const args = process.argv.slice(2);

if (args[0] === "auth" && args[1] === "token") {
  console.log("ghp_fake_test_token");
} else {
  console.error(`unknown command: ${args.join(" ")}`);
  process.exit(2);
}
