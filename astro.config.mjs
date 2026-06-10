import { defineConfig, envField } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  adapter: vercel(),
  site: "https://mindthegael.co.uk",
  env: {
    schema: {
      STRIPE_SECRET_KEY: envField.string({ context: "server", access: "secret" }),
      PUBLIC_SITE: envField.string({ context: "server", access: "public" }),
    },
  },
});