import type { FilterDef, SortDef } from "@/lib/validators/report.schema";

/**
 * Maps validated filter definitions into Prisma `where` clause objects.
 * All field names must exist in the provided fieldMap — unknown fields are rejected.
 *
 * The fieldMap maps UI field names (e.g., "siteId") to Prisma field paths
 * (e.g., "employee.siteId" becomes { employee: { siteId: <value> } }).
 */

export type FieldMapEntry = {
  /** Dot-separated Prisma path, e.g. "employee.site.name" */
  prismaPath: string;
  /** The value type for validation */
  type: "string" | "number" | "date" | "boolean";
};

export type FieldMap = Record<string, FieldMapEntry>;

/**
 * Builds a nested Prisma `where` object from an array of filter definitions.
 */
export function buildWhereClause(
  filters: FilterDef[],
  fieldMap: FieldMap
): Record<string, unknown> {
  const conditions: Record<string, unknown>[] = [];

  for (const filter of filters) {
    const entry = fieldMap[filter.field];
    if (!entry) {
      throw new Error(`Unknown filter field: ${filter.field}`);
    }

    const prismaCondition = buildSingleCondition(filter, entry);
    conditions.push(prismaCondition);
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

function buildSingleCondition(
  filter: FilterDef,
  entry: FieldMapEntry
): Record<string, unknown> {
  const { operator, value, value2 } = filter;
  const pathParts = entry.prismaPath.split(".");

  let prismaOp: unknown;

  switch (operator) {
    case "eq":
      prismaOp = coerceValue(value, entry.type);
      break;
    case "neq":
      prismaOp = { not: coerceValue(value, entry.type) };
      break;
    case "in":
      prismaOp = { in: Array.isArray(value) ? value.map((v) => coerceScalar(v, entry.type)) : [coerceScalar(value, entry.type)] };
      break;
    case "notIn":
      prismaOp = { notIn: Array.isArray(value) ? value.map((v) => coerceScalar(v, entry.type)) : [coerceScalar(value, entry.type)] };
      break;
    case "gt":
      prismaOp = { gt: coerceScalar(value, entry.type) };
      break;
    case "gte":
      prismaOp = { gte: coerceScalar(value, entry.type) };
      break;
    case "lt":
      prismaOp = { lt: coerceScalar(value, entry.type) };
      break;
    case "lte":
      prismaOp = { lte: coerceScalar(value, entry.type) };
      break;
    case "between":
      prismaOp = {
        gte: coerceScalar(value, entry.type),
        lte: coerceScalar(value2!, entry.type),
      };
      break;
    case "contains":
      prismaOp = { contains: String(value), mode: "insensitive" };
      break;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }

  // Build nested object from path parts, e.g. "employee.site.name" → { employee: { site: { name: prismaOp } } }
  return nestPath(pathParts, prismaOp);
}

function nestPath(
  parts: string[],
  value: unknown
): Record<string, unknown> {
  if (parts.length === 1) {
    return { [parts[0]]: value };
  }
  return { [parts[0]]: nestPath(parts.slice(1), value) };
}

function coerceValue(
  value: unknown,
  type: string
): unknown {
  if (type === "date" && typeof value === "string") return new Date(value);
  if (type === "number" && typeof value === "string") return Number(value);
  if (type === "boolean" && typeof value === "string") return value === "true";
  return value;
}

function coerceScalar(
  value: unknown,
  type: string
): unknown {
  if (type === "date" && typeof value === "string") return new Date(value);
  if (type === "number" && typeof value === "string") return Number(value);
  return value;
}

/**
 * Builds Prisma `orderBy` from sort definitions.
 */
export function buildOrderBy(
  sortBy: SortDef[],
  fieldMap: FieldMap
): Record<string, unknown>[] {
  return sortBy.map((sort) => {
    const entry = fieldMap[sort.field];
    if (!entry) {
      throw new Error(`Unknown sort field: ${sort.field}`);
    }
    const parts = entry.prismaPath.split(".");
    return nestPath(parts, sort.direction);
  });
}
