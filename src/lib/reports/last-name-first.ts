/**
 * A name written last name first, "Acquah, Moses", the way payroll lists
 * people. A name is split at its first space, as the time clocks and the
 * People API split it (so "Sahara Irigoyen Herdoiza" is "Irigoyen Herdoiza,
 * Sahara"), and one already written "Last, First" is left as it is.
 */
export function lastNameFirst(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.includes(",")) return n;
  const space = n.indexOf(" ");
  return space > 0 ? `${n.slice(space + 1)}, ${n.slice(0, space)}` : n;
}
