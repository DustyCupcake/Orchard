// For code that runs outside a request — a scheduled job, or a library
// function a request happens to be several calls above — where there is no
// origin to read. APP_URL is what Caddy serves publicly and is always set in
// a real deployment; the fallback only matters on a developer's machine.
// Kept apart from app-url.ts, which imports next/headers and so is only
// loadable where Next is.
export function publicAppUrl(): string {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
