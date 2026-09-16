import { defineConfig, envField } from "astro/config";
import vercel from "@astrojs/vercel";

export default defineConfig({
  // imageService: true routes <Image> through Vercel's own image optimization
  // instead of Astro's built-in /_image endpoint. Pages rendered on demand
  // (the homepage and the content hub) cannot have their image variants
  // generated at build time, so they fall back to optimizing per request, and
  // /_image is not served in this deployment. Without this, every image on an
  // on-demand page 404s.
  adapter: vercel({ imageService: true }),
  site: "https://mindthegael.co.uk",
  env: {
    schema: {
      STRIPE_SECRET_KEY: envField.string({ context: "server", access: "secret" }),
      PUBLIC_SITE: envField.string({ context: "server", access: "public" }),
    },
  },
});