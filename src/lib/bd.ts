import { spawn } from "node:child_process";

const TIMEOUT_MS = 30_000;

export function runBd(args: string[], cwd: string): Promise<unknown> {
  const beadsBin = process.env.BEADS_BIN ?? "bd";
  return new Promise((resolve, reject) => {
    const child = spawn(/* turbopackIgnore: true */ beadsBin, [...args, "--json"], { cwd });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`bd ${args.join(" ")} timed out`));
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to start bd: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`bd ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(stdout.trim() ? JSON.parse(stdout) : null);
      } catch {
        reject(new Error(`bd ${args.join(" ")} returned invalid JSON`));
      }
    });
  });
}
