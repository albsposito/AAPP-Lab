const fallbackUrl = 'http://localhost:4000';

const envUrl = (import.meta as ImportMeta).env?.VITE_BACKEND_URL as string | undefined;

export const BACKEND_URL =
  typeof envUrl === 'string' && envUrl.length > 0 ? envUrl : fallbackUrl;
