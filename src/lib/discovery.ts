import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const MAX_SCAN_DEPTH = 3;
const MAX_PROJECTS = 50;
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".venv",
  "target",
  "dist",
  "build",
  "vendor",
  ".cache",
  ".beads",
]);

export interface BeadsProject {
  path: string;
  name: string;
}

export function hasBeadsProject(beadsDir: string): boolean {
  return (
    existsSync(join(beadsDir, "metadata.json")) ||
    existsSync(join(beadsDir, "embeddeddolt")) ||
    existsSync(join(beadsDir, "dolt")) ||
    existsSync(join(beadsDir, "issues.jsonl")) ||
    existsSync(join(beadsDir, "config.yaml"))
  );
}

function findCwdProject(cwd: string): BeadsProject | null {
  let dir = resolve(cwd);
  for (;;) {
    const beadsDir = join(dir, ".beads");
    if (existsSync(beadsDir) && hasBeadsProject(beadsDir)) {
      return { path: dir, name: basename(dir) };
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function registryProjects(beadsHome: string): BeadsProject[] {
  const registryPath = join(beadsHome, "registry.json");
  if (!existsSync(registryPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(registryPath, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];

  const projects: BeadsProject[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const path = e.path ?? e.workspace_path ?? e.WorkspacePath ?? e.workspacePath;
    if (typeof path !== "string") continue;
    const dir = resolve(path);
    const beadsDir = join(dir, ".beads");
    if (existsSync(beadsDir) && hasBeadsProject(beadsDir)) {
      projects.push({ path: dir, name: basename(dir) });
    }
  }
  return projects;
}

function scanProjects(root: string, depth: number): BeadsProject[] {
  if (depth > MAX_SCAN_DEPTH) return [];
  const found: BeadsProject[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return found;
  }
  for (const entry of entries) {
    if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
    const dir = join(root, entry);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const beadsDir = join(dir, ".beads");
    if (existsSync(beadsDir) && hasBeadsProject(beadsDir)) {
      found.push({ path: dir, name: basename(dir) });
    } else if (depth < MAX_SCAN_DEPTH) {
      found.push(...scanProjects(dir, depth + 1));
    }
  }
  return found;
}

function defaultRoots(cwd: string): string[] {
  const home = homedir();
  return [cwd, join(home, "Projects"), join(home, "Dotfiles")];
}

export function discoverProjects(cwd: string): BeadsProject[] {
  const envRoots = process.env.BEADS_PROJECT_ROOTS;
  const roots = envRoots
    ? envRoots.split(",").map((r) => r.trim()).filter(Boolean)
    : defaultRoots(cwd);

  const seen = new Map<string, BeadsProject>();
  const add = (project: BeadsProject) => {
    const key = resolve(project.path);
    if (!seen.has(key)) seen.set(key, { ...project, path: key });
  };

  const cwdProject = findCwdProject(cwd);
  if (cwdProject) add(cwdProject);

  const beadsHome = process.env.BEADS_HOME ?? join(homedir(), ".beads");
  for (const project of registryProjects(beadsHome)) add(project);

  for (const root of roots) {
    const expanded = root.replace(/^~(?=$|\/)/, homedir());
    for (const project of scanProjects(expanded, 1)) add(project);
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_PROJECTS);
}
