#!/usr/bin/env node
// Fake bd for tests: answers subcommands from tests/fixtures/beads-data.json.
// Supports: list [--ready] [--all], status, show <id>, comments <id>, fail, badjson.
// The events journal is on when FAKE_BD_EVENTS points at a JSON Lines file
// (or the project has .beads/fake-events.jsonl): `events tail --since N
// --follow` prints its records past N and keeps printing lines appended to it
// until killed. FAKE_BD_DATA (or .beads/fake-data.json) swaps in other data.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const localData = join(process.cwd(), ".beads", "fake-data.json");
const localJournal = join(process.cwd(), ".beads", "fake-events.jsonl");
const journal = process.env.FAKE_BD_EVENTS ?? (existsSync(localJournal) ? localJournal : null);

const data = JSON.parse(
  readFileSync(
    process.env.FAKE_BD_DATA ?? (existsSync(localData) ? localData : new URL("./beads-data.json", import.meta.url)),
    "utf8",
  ),
);

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);

switch (command) {
  case "status":
    print(data.status);
    break;
  case "list": {
    if (rest.includes("--ready")) print(data.ready);
    else if (rest.includes("--parent")) {
      const parent = rest[rest.indexOf("--parent") + 1];
      print(data.list.filter((issue) => issue.parent === parent));
    } else print(data.list);
    break;
  }
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
  case "config":
    print({ key: rest[1], value: journal ? "true" : "false" });
    break;
  case "events":
    followEvents(Number(rest[rest.indexOf("--since") + 1]));
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

function followEvents(since) {
  const file = journal;
  if (process.env.FAKE_BD_LOG) appendFileSync(process.env.FAKE_BD_LOG, `${args.join(" ")}\n`);
  let printed = 0;
  const flush = () => {
    const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    for (const line of lines.slice(printed)) {
      if (JSON.parse(line).seq > since) console.log(line);
    }
    printed = lines.length;
  };
  flush();
  setInterval(flush, 20);
}

function print(value) {
  console.log(JSON.stringify(value));
}
