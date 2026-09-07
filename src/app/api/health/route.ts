export async function GET() {
  return Response.json({
    app: "view-beads",
    build: process.env.VIEW_BEADS_BUILD ?? null,
  });
}
