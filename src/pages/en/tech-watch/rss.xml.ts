import type { APIRoute } from "astro";
import { watchRss } from "@/lib/watch-rss";

export const GET: APIRoute = ({ site }) => watchRss("en", site!);
