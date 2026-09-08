export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    process.title = "view-beads";
  }
}
