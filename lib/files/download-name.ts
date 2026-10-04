export function downloadName(order: number, name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
  return `${String(order).padStart(2, "0")}-${slug}.jpg`;
}
