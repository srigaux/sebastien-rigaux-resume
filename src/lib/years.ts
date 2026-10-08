export function yearsSince(date: string, today = new Date()): number {
  const [year, month, day] = date.split("-").map(Number);
  const anniversaryPassed =
    today.getUTCMonth() + 1 > month ||
    (today.getUTCMonth() + 1 === month && today.getUTCDate() >= day);

  return today.getUTCFullYear() - year - (anniversaryPassed ? 0 : 1);
}
