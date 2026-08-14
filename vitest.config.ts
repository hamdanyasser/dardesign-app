import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/* ============================================================
   The frontend's second gate.

   `npm run build` proves the app compiles; it cannot prove that the
   placement engine refuses what it should. Everything under test here
   is deliberately pure — no React, no THREE, no network — which is why
   `src/lib/design/` was written that way in the first place.

   Scope is narrow on purpose: the modules that decide whether something
   is allowed into a user's room. A broad component-testing setup is a
   different project and is not what this file is for.
   ============================================================ */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
