#!/usr/bin/env node
// Fake bd for tests: answers subcommands from tests/fixtures/beads-data.json.
// Supports: list [--ready] [--all], status, show <id>, comments <id>, fail, badjson.
// The events journal is on when FAKE_BD_EVENTS points at a JSON Lines file
// (or the project has .beads/fake-events.jsonl): `events tail --since N
// --follow` prints its records past N and keeps printing lines appended to it
// until killed. FAKE_BD_DATA (or .beads/fake-data.json) swaps in other data.
// `serve` starts a loopback HTTP server with the bd serve endpoints view-beads
// uses (it fails when FAKE_BD_SERVE_FAIL is set). FAKE_BD_LOG records every
// invocation.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const localData = join(process.cwd(), ".beads", "fake-data.json");
const localJournal = join(process.cwd(), ".beads", "fake-events.jsonl");
const journal = process.env.FAKE_BD_EVENTS ?? (existsSync(localJournal) ? localJournal : null);

function loadData() {
  return JSON.parse(
    readFileSync(
      process.env.FAKE_BD_DATA ?? (existsSync(localData) ? localData : new URL("./beads-data.json", import.meta.url)),
      "utf8",
    ),
  );
}
const data = loadData();

const args = process.argv.slice(2);
const command = args[0];
const rest = args.slice(1);
if (process.env.FAKE_BD_LOG) appendFileSync(process.env.FAKE_BD_LOG, `${args.join(" ")}\n`);

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
    followEvents(Number(rest[rest.indexOf("--since") + 1]), (line) => console.log(line));
    break;
  case "serve":
    if (process.env.FAKE_BD_SERVE_FAIL) {
      console.error("Dolt server unreachable");
      process.exit(1);
    }
    serve();
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

function followEvents(since, emit) {
  let printed = 0;
  const flush = () => {
    const lines = existsSync(journal) ? readFileSync(journal, "utf8").split("\n").filter(Boolean) : [];
    for (const line of lines.slice(printed)) {
      if (JSON.parse(line).seq > since) emit(line);
    }
    printed = lines.length;
  };
  flush();
  return setInterval(flush, 20);
}

function serve() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const current = loadData();
    const json = (body, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/v0/beads/issues") return json({ items: current.list, has_more: false });
    if (url.pathname === "/v0/beads/ready") return json({ items: current.ready, has_more: false });
    if (url.pathname === "/v0/beads/stats") return json({ summary: current.status.summary, blocked_count_skipped: false });
    if (url.pathname === "/v0/beads/events:watch") {
      if (!journal) return json({ code: "events_journal_disabled" }, 409);
      const since = Number(req.headers["last-event-id"] ?? url.searchParams.get("since"));
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("retry: 3000\n\n");
      const timer = followEvents(since, (line) => res.write(`id: ${JSON.parse(line).seq}\ndata: ${line}\n\n`));
      req.on("close", () => clearInterval(timer));
      return;
    }
    json({ code: "not_found" }, 404);
  });
  server.listen(0, "127.0.0.1", () => {
    console.log(`bd serve: listening on http://127.0.0.1:${server.address().port}`);
  });
}

function print(value) {
  console.log(JSON.stringify(value));
}
