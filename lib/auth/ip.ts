/** The caller's address, as Render's proxy reports it: the first hop of x-forwarded-for. */
export function clientIp(request: Request | undefined): string {
  return request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
