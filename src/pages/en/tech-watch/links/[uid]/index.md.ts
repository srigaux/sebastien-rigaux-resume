import type { APIRoute } from "astro";
import { getWatchLinkStaticPaths } from "@/lib/watch-pages";
import { markdownResponse, watchLinkMarkdown } from "@/lib/watch-markdown";
export const getStaticPaths = () => getWatchLinkStaticPaths("en");
export const GET: APIRoute = ({ props, site }) => markdownResponse(watchLinkMarkdown(props.link, site!));
