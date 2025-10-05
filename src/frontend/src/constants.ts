const fallbackUrl = 'http://localhost:4000';

const envUrl = (import.meta as ImportMeta).env?.VITE_BACKEND_URL as string | undefined;

const runtimeUrl =
  typeof window !== 'undefined'
    ? window.__APP_CONFIG__?.backendUrl
    : undefined;

export const BACKEND_URL = [runtimeUrl, envUrl, fallbackUrl].find(
  (value) => typeof value === 'string' && value.length > 0
) as string;
