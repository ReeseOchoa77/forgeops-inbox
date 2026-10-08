/**
 * Web-only environment helpers.
 * Vite sets import.meta.env.PROD=true for production builds — the badge must
 * never render there even if VITE_APP_ENV is mis-set.
 */

export function shouldShowDevelopmentIndicator(env: {
  PROD?: boolean;
  DEV?: boolean;
  VITE_APP_ENV?: string;
}): boolean {
  if (env.PROD === true) return false;
  if (env.DEV === true) return true;
  const appEnv = (env.VITE_APP_ENV ?? "").trim().toLowerCase();
  return appEnv === "development" || appEnv === "dev" || appEnv === "local";
}
