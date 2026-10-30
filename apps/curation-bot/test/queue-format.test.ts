import { expect, it } from "vitest";
import { queueHtml, type QueueRow } from "@/queue-format";
const row = (fields: Partial<QueueRow> = {}): QueueRow => ({
  id: "u42",
  status: "queued",
  active: 0,
  title: null,
  url: "https://example.com/article?secret=token",
  publication_check_status: null,
  total_count: 1,
  blocked: 0,
  ...fields,
});
it("shows titles, human statuses and an actionable explanation instead of internal states", () => {
  const result = queueHtml(
    [
      row({
        status: "publication_pending",
        publication_check_status: "attention",
        title: "<Script> & un titre",
        total_count: 3,
        blocked: 1,
      }),
      row({
        id: "u43",
        status: "waiting_publish_slot",
        title: "Mon article validé",
        total_count: 3,
      }),
      row({
        id: "u44",
        status: "review",
        title: "Mon article à valider",
        active: 1,
        total_count: 3,
      }),
    ],
    1,
  );
  expect(result.text).toContain("3 liens");
  expect(result.text).toContain("&lt;Script&gt; &amp; un titre");
  expect(result.text).toContain("/reprendre u42");
  expect(result.text).toContain("Validés, prêts à publier");
  expect(result.text).toContain("À valider");
  expect(result.text).toContain("Tu peux continuer à préparer et valider");
  expect(result.text).not.toMatch(
    /publication_pending|waiting_publish_slot|queued|secret=token/,
  );
});
it("handles empty queues, missing titles and pagination within Telegram message limits", () => {
  expect(queueHtml([], 1).text).toContain("Ta file est vide");
  expect(queueHtml([], 4).text).toContain("Cette page est vide");
  const items = Array.from({ length: 8 }, (_, i) =>
    row({ id: `u${i}`, title: "&".repeat(300), total_count: 19 }),
  );
  const result = queueHtml(items, 2);
  expect(result.pages).toBe(3);
  expect(result.text).toContain("Page 2/3");
  expect(result.text.replaceAll("&amp;", "&").length).toBeLessThan(4096);
  expect(queueHtml([row()], 1).text).toContain("example.com/article");
});
