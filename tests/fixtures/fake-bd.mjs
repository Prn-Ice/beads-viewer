#!/usr/bin/env node
// Fake bd for tests: answers subcommands from tests/fixtures/beads-data.json.
// Supports: list [--ready] [--all], status, show <id>, comments <id>, fail, badjson.

import { readFileSync } from "node:fs";

const data = JSON.parse(
  readFileSync(new URL("./beads-data.json", import.meta.url), "utf8"),
);

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

switch (command) {
  case "status":
    print(data.status);
    break;
  case "list":
    if (rest.includes("--ready")) print(data.ready);
    else print(data.list);
    break;
  case "show": {
    const issue = data.show[rest[0]];
    if (!issue) {
      console.error("issue not found");
      process.exit(1);
    }
    print(issue);
    break;
  }
  case "comments":
    print(data.comments[rest[0]] ?? []);
    break;
  case "fail":
    console.error("boom");
    process.exit(2);
    break;
  case "badjson":
    console.log("this is not json");
    break;
  default:
    console.error(`unknown command: ${command}`);
    process.exit(2);
}

function print(value) {
  console.log(JSON.stringify(value));
}
