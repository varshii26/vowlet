import { prisma } from "@/lib/db";
import { seedDemo } from "@/lib/seed/demo";

async function main() {
  await seedDemo(prisma);
  console.log("Seeded the Priya & Sam demo.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
