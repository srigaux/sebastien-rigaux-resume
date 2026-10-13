import type { APIRoute } from "astro";
import { getWatchStaticPaths, type WatchPageProps } from "@/lib/watch-pages";
import { markdownResponse, watchArchiveMarkdown } from "@/lib/watch-markdown";
export const getStaticPaths = async () => (await getWatchStaticPaths("fr")).filter((route) => route.params.path !== undefined);
export const GET: APIRoute = ({ props, site }) => markdownResponse(watchArchiveMarkdown(props as WatchPageProps, site!));
