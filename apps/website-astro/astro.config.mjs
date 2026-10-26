// @ts-check
import { existsSync } from "node:fs";
import {
  readFile,
  writeFile,
  mkdtemp,
  mkdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { defineConfig, fontProviders } from "astro/config";
import react from "@astrojs/react";
import siteSitemap from "#site-sitemap";
import tailwindcss from "@tailwindcss/vite";
import astroLlmsTxt from "@4hse/astro-llms-txt";
import pdf from "astro-pdf";

import partytown from "@astrojs/partytown";

import playformInline from "@playform/inline";

import playformCompress from "@playform/compress";

// Astro loads .env files after this config, so load the local browser path here.
const envFile = new URL("../../.env.local", import.meta.url);
if (existsSync(envFile)) loadEnvFile(fileURLToPath(envFile));
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;

export default defineConfig({
  site: "https://sebastien.rigaux.be",
  integrations: [react(), siteSitemap(), astroLlmsTxtForFileBuild({
    title: "Sébastien Rigaux — CV et veille / Résumé and tech watch",
    description:
      "CV bilingue et veille technologique de Sébastien Rigaux, directeur technique (CTO) et Tech Lead spécialisé en architecture logicielle, produits web et mobiles et transition vers l’IA.",
    details:
      "Pages officielles : [français](https://sebastien.rigaux.be/) et [English](https://sebastien.rigaux.be/en).",
    notes:
      "Contenu généré automatiquement à partir des pages publiques du CV et des sélections de veille ; les pages HTML restent les sources canoniques.",
    optionalLinks: [
      {
        label: "Veille technologique — index Markdown",
        url: "https://sebastien.rigaux.be/veille.md",
        description:
          "Toutes les sélections, leurs permaliens et leurs versions Markdown.",
      },
      {
        label: "Tech watch — Markdown index",
        url: "https://sebastien.rigaux.be/en/tech-watch.md",
        description:
          "All selected resources, their permalinks and Markdown versions.",
      },
    ],
    docSet: [
      {
        title: "CV complet / Full résumé",
        description:
          "Le CV complet en français et en anglais / The complete résumé in French and English.",
        url: "/llms-full.txt",
        include: ["/", "en/"],
        promote: ["/", "en/"],
        mainSelector: "main",
      },
      {
        title: "CV en français",
        description: "Version Markdown de la page française du CV.",
        url: "/fr.md",
        include: ["/"],
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
  }), pdf({
    pages: {
      "/": "/pdf/Sebastien-Rigaux-CV-FR.pdf",
      "/en": "/pdf/Sebastien-Rigaux-CV-EN.pdf",
    },
    baseOptions: {
      throwOnFail: true,
      // Apply print media before navigation so decorative WebGL never starts in PDF pages.
      preCallback: (page) => page.emulateMediaType("print"),
      pdf: {
        format: "A4",
        printBackground: true,
        preferCSSPageSize: true,
      },
    },
    launch: {
      ...(executablePath ? { executablePath } : {}),
      // GitHub's Ubuntu runner cannot sandbox Chrome for Testing.
      ...(process.env.GITHUB_ACTIONS === "true" &&
      process.platform === "linux"
        ? { args: ["--no-sandbox"] }
        : {}),
    },
  }), partytown({ config: { forward: ["dataLayer.push", "gtag"] } }), playformInline(), playformCompress()],
  i18n: {
    locales: ["fr", "en"],
    defaultLocale: "fr",
    routing: {
      prefixDefaultLocale: false,
      // The French CV lives at /; /fr/ has its own immediate static redirect page.
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
  trailingSlash: "never",
  build: { format: "file" },
  vite: {
    plugins: [tailwindcss()],
  },
});

/**
 * Adapts the directory-only Astro LLMs TXT integration to a file-based build.
 *
 * @param {Parameters<typeof astroLlmsTxt>[0]} options
 */
function astroLlmsTxtForFileBuild(options) {
  const integration = astroLlmsTxt(options);
  const onBuildDone = integration.hooks["astro:build:done"];
  // The LLM integration expects directory/index.html output. Adapt only the
  // two CV inputs in a temporary directory; the public build stays file-based.
  integration.hooks["astro:build:done"] = async (context) => {
    const temporary = await mkdtemp(join(tmpdir(), "astro-llms-"));
    const temporaryDir = pathToFileURL(`${temporary}/`);
    try {
      await mkdir(new URL("en/", temporaryDir));
      await Promise.all([
        copyFile(
          new URL("index.html", context.dir),
          new URL("index.html", temporaryDir),
        ),
        copyFile(
          new URL("en.html", context.dir),
          new URL("en/index.html", temporaryDir),
        ),
      ]);
      await onBuildDone?.({
        ...context,
        dir: temporaryDir,
        pages: [{ pathname: "/" }, { pathname: "en/" }],
      });
      for (const name of ["llms.txt", "fr.md", "en.md", "llms-full.txt"]) {
        await copyFile(new URL(name, temporaryDir), new URL(name, context.dir));
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }

    // The package wraps descriptions in <SYSTEM>, which reads like a prompt
    // instruction in a public document. Keep each export as ordinary Markdown
    // with a direct link back to its canonical HTML page.
    const exports = [
      [
        "fr.md",
        "Source canonique : [CV en français](https://sebastien.rigaux.be/)",
      ],
      [
        "en.md",
        "Canonical source: [English résumé](https://sebastien.rigaux.be/en)",
      ],
      [
        "llms-full.txt",
        "Sources canoniques : [français](https://sebastien.rigaux.be/) · [English](https://sebastien.rigaux.be/en)",
      ],
    ];
    for (const [name, source] of exports) {
      const file = fileURLToPath(new URL(name, context.dir));
      const content = await readFile(file, "utf8");
      if (content.length < 500 || !content.startsWith("<SYSTEM>")) {
        throw new Error(`Incomplete LLM export: ${name}`);
      }
      const clean = content.replace(
        /^<SYSTEM>(.*?)<\/SYSTEM>\n\n/s,
        (_, description) => `> ${description}\n\n${source}\n\n`,
      );
      await writeFile(file, clean, "utf8");
    }
  };
  return integration;
}