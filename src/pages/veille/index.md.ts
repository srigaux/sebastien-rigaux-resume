import type { APIRoute } from "astro";
import { getWatchData } from "@/lib/watch-prismic";
import { markdownResponse, watchIndexMarkdown } from "@/lib/watch-markdown";
export const GET: APIRoute = async ({ site }) => {
  const { links } = await getWatchData("fr");
  return markdownResponse(watchIndexMarkdown("fr", links, site!));
};
