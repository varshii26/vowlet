export async function register() {
  // Runs once when the server starts. Seed the demo if the database is empty so
  // restarts and redeploys never leave judges with a blank app.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { prisma } = await import("@/lib/db");
  const { ensureSeeded } = await import("@/lib/seed/demo");

  try {
    const seeded = await ensureSeeded(prisma);
    if (seeded) console.log("[vowlet] Empty database: seeded the demo wedding.");
  } catch (error) {
    console.error("[vowlet] Startup seeding failed:", error);
  }
}
