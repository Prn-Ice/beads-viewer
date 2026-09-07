import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverProjects, hasBeadsProject } from "./discovery";

const ORIGINAL_ROOTS = process.env.BEADS_PROJECT_ROOTS;
const ORIGINAL_HOME = process.env.BEADS_HOME;

let tempDir: string;

function makeProject(root: string, name: string) {
  const dir = join(root, name);
  mkdirSync(join(dir, ".beads"), { recursive: true });
  writeFileSync(join(dir, ".beads", "metadata.json"), "{}");
  return dir;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "view-beads-discovery-"));
  process.env.BEADS_PROJECT_ROOTS = join(tempDir, "roots");
  process.env.BEADS_HOME = join(tempDir, "beads-home");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (ORIGINAL_ROOTS === undefined) delete process.env.BEADS_PROJECT_ROOTS;
  else process.env.BEADS_PROJECT_ROOTS = ORIGINAL_ROOTS;
  if (ORIGINAL_HOME === undefined) delete process.env.BEADS_HOME;
  else process.env.BEADS_HOME = ORIGINAL_HOME;
});

describe("hasBeadsProject", () => {
  it("detects a project from metadata.json", () => {
    const beadsDir = join(tempDir, "proj", ".beads");
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(join(beadsDir, "metadata.json"), "{}");
    expect(hasBeadsProject(beadsDir)).toBe(true);
  });

  it("rejects an empty directory", () => {
    const beadsDir = join(tempDir, "proj", ".beads");
    mkdirSync(beadsDir, { recursive: true });
    expect(hasBeadsProject(beadsDir)).toBe(false);
  });
});

describe("discoverProjects", () => {
  it("finds the project from cwd by walking up", () => {
    const project = makeProject(tempDir, "alpha");
    const cwd = join(project, "src", "nested");
    mkdirSync(cwd, { recursive: true });
    const names = discoverProjects(cwd).map((p) => p.name);
    expect(names).toContain("alpha");
  });

  it("finds projects listed in the beads registry", () => {
    const project = makeProject(tempDir, "registry-proj");
    const home = process.env.BEADS_HOME as string;
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(home, "registry.json"),
      JSON.stringify([{ path: project }, { path: join(tempDir, "missing") }]),
    );
    const names = discoverProjects(tempDir).map((p) => p.name);
    expect(names).toContain("registry-proj");
  });

  it("scans roots three levels deep for projects", () => {
    const roots = process.env.BEADS_PROJECT_ROOTS as string;
    mkdirSync(join(roots, "personal", "deep-project"), { recursive: true });
    makeProject(join(roots, "personal"), "deep-project");
    mkdirSync(join(roots, "personal", "too", "deep", "beyond"), { recursive: true });
    makeProject(join(roots, "personal", "too", "deep"), "beyond");

    const projects = discoverProjects(join(tempDir, "elsewhere"));
    const names = projects.map((p) => p.name);
    expect(names).toContain("deep-project");
    expect(names).not.toContain("beyond");
  });

  it("deduplicates a project found by registry and scan", () => {
    const roots = process.env.BEADS_PROJECT_ROOTS as string;
    mkdirSync(roots, { recursive: true });
    const project = makeProject(roots, "dup");
    const home = process.env.BEADS_HOME as string;
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "registry.json"), JSON.stringify([{ path: project }]));

    const matches = discoverProjects(tempDir).filter((p) => p.name === "dup");
    expect(matches).toHaveLength(1);
  });

  it("sorts projects by name", () => {
    makeProject(tempDir, "zebra");
    makeProject(tempDir, "alpha");
    const names = discoverProjects(tempDir).map((p) => p.name);
    expect(names).toEqual([...names].sort());
  });
});
