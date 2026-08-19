/**
 * Employee-ID normalisation for roster matching.
 */

/**
 * Employee IDs for matching, with leading zeros removed.
 *
 * HR systems issue zero-padded ids ("015473"). Spreadsheets treat that column
 * as a number and export "15473". The id lookup then misses, the email hits,
 * and the row is refused as an "ID change" — 25+ of them in a real export,
 * every one a false alarm about a person whose id never changed.
 *
 * Used ONLY to decide that two ids denote the same person. The id stored in
 * the database stays authoritative: a row matched this way is written against
 * the stored form, never the truncated one from the file.
 */
export function canonicalEmployeeId(id: string): string {
  const trimmed = id.trim();
  const stripped = trimmed.replace(/^0+/, "");
  return (stripped || trimmed).toLowerCase();
}
