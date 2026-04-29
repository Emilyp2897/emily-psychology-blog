import { defineConfig, envField } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  adapter: vercel(),
  site: "https://emily-psychology-blog.vercel.app",
  env: {
    schema: {
      STRIPE_SECRET_KEY: envField.string({ context: "server", access: "secret" }),
      PUBLIC_SITE: envField.string({ context: "server", access: "public" }),
    },
  },
});