// @ts-check
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { defineConfig, fontProviders } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import astroLlmsTxt from "@4hse/astro-llms-txt";
import pdf from "astro-pdf";

// Astro loads .env files after this config, so load the local browser path here.
if (existsSync(".env.local")) loadEnvFile(".env.local");
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

export default defineConfig({
  site: "https://sebastien.rigaux.be",
  integrations: [
    react(),
    sitemap({
      filter: (page) => ["/fr/", "/en/"].includes(new URL(page).pathname),
    }),
    astroLlmsTxt({
      title: "Sébastien Rigaux — CV / Résumé",
      description:
        "CV bilingue de Sébastien Rigaux, directeur technique (CTO) et Tech Lead spécialisé en architecture logicielle, produits web et mobiles et transition vers l’IA.",
      details:
        "Pages officielles : [français](https://sebastien.rigaux.be/fr/) et [English](https://sebastien.rigaux.be/en/).",
      notes:
        "Contenu généré automatiquement à partir des pages publiques du CV ; ces pages restent la source de référence.",
      docSet: [
        {
          title: "CV complet / Full résumé",
          description:
            "Le CV complet en français et en anglais / The complete résumé in French and English.",
          url: "/llms-full.txt",
          include: ["fr/", "en/"],
          promote: ["fr/", "en/"],
          mainSelector: "main",
        },
        {
          title: "CV en français",
          description: "Version Markdown de la page française du CV.",
          url: "/fr.md",
          include: ["fr/"],
          mainSelector: "main",
        },
        {
          title: "Résumé in English",
          description: "Markdown version of the English résumé page.",
          url: "/en.md",
          include: ["en/"],
          mainSelector: "main",
        },
      ],
      pageSeparator: "\n\n---\n\n",
    }),
    pdf({
      pages: {
        "/fr/": "/pdf/Sebastien-Rigaux-CV-FR.pdf",
        "/en/": "/pdf/Sebastien-Rigaux-CV-EN.pdf",
      },
      baseOptions: {
        throwOnFail: true,
        pdf: {
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
        },
      },
      launch: {
        ...(executablePath ? { executablePath } : {}),
        // GitHub's Ubuntu runner cannot sandbox Chrome for Testing.
        ...(process.env.GITHUB_ACTIONS === "true" && process.platform === "linux"
          ? { args: ["--no-sandbox"] }
          : {}),
      },
    }),
  ],
  i18n: {
    locales: ["fr", "en"],
    defaultLocale: "fr",
    routing: {
      prefixDefaultLocale: true,
      // The root page handles the GitHub Pages redirect without Astro's 2-second delay.
      redirectToDefaultLocale: false,
    },
  },
  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "IBM Plex Sans",
      cssVariable: "--font-plex-sans",
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
    },
    {
      provider: fontProviders.fontsource(),
      name: "Sora",
      cssVariable: "--font-sora",
      weights: [500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
    },
  ],
  output: "static",
  trailingSlash: "always",
  vite: {
    plugins: [tailwindcss()],
  },
});
