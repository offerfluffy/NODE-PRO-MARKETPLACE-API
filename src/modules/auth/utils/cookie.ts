export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  const prefix = `${name}=`;

  const cookie = cookieHeader
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) return undefined;

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return undefined;
  }
}
