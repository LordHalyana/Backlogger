/** A UUID (versions 1–8, RFC 4122 variant), in either case. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** A UUID already in canonical lowercase, as Backlogger writes them to disk. */
export function isLowercaseUuid(value: unknown): value is string {
  return isUuid(value) && value === value.toLowerCase();
}
