/** True when a database error (possibly wrapped by Drizzle) is a unique-constraint violation. */
export function isUniqueViolation(
  error: unknown,
  constraint?: string,
): boolean {
  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const details = (cause ?? {}) as { code?: string; constraint?: string };
  return (
    details.code === '23505' &&
    (constraint === undefined || details.constraint === constraint)
  );
}
