/**
 * URL search-param helpers. Pure, no Next.js / React imports — usable
 * from RSC pages, route handlers, and test code.
 */

/**
 * Narrow a `string | undefined` URL search param against a known set of
 * valid values. Returns the typed value when matched, `undefined`
 * otherwise. Uses an in-memory `Set` for O(1) lookup.
 *
 * @example
 *   const VISA_TYPE_SET = new Set<string>(VISA_TYPES);
 *   const visa = parseEnumParam<VisaType>(params.visa, VISA_TYPE_SET);
 */
export function parseEnumParam<T extends string>(
  raw: string | undefined,
  valid: ReadonlySet<string>,
): T | undefined {
  return raw && valid.has(raw) ? (raw as T) : undefined;
}

/**
 * Convenience builder: from a readonly array of valid values, returns
 * both a type-safe parser and the underlying Set. Saves the boilerplate
 * `new Set<string>(VALUES)` at every call site.
 *
 * @example
 *   const visa = parseEnum(params.visa, VISA_TYPES);
 *   //    ^? VisaType | undefined
 */
export function parseEnum<T extends string>(
  raw: string | undefined,
  valid: readonly T[],
): T | undefined {
  return raw && (valid as readonly string[]).includes(raw)
    ? (raw as T)
    : undefined;
}
