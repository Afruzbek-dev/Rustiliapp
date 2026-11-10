const PROTECTED_PREFIXES = ["/home", "/path", "/lesson", "/words", "/speak", "/rating", "/test", "/curator", "/teacher"];

/** True for student and staff routes that need a session. */
export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
