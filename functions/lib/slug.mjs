const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Event addresses are immutable. Seeds use their curated id, automatic rows
 * use the year plus a fingerprint prefix, never the title.
 */
export function seedSlug(seedId) {
  const value = String(seedId || "").toLowerCase();
  return SLUG_RE.test(value) ? value : "";
}

export function autoSlug(year, fingerprint, length = 8) {
  const head = String(fingerprint || "").toLowerCase().slice(0, length);
  if (!/^[a-z0-9]+$/.test(head)) return "";
  return `y${year}-${head}`;
}

export function isSlug(value) {
  return (
    typeof value === "string" &&
    value.length >= 4 &&
    value.length <= 120 &&
    SLUG_RE.test(value)
  );
}
