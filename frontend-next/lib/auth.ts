// lib/auth.ts
const STORAGE_KEY = "hazard_token";

export function setToken(token: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, token);
  }
}

export function getToken(): string | null {
  if (typeof window !== "undefined") {
    return localStorage.getItem(STORAGE_KEY);
  }
  return null;
}

export function clearToken() {
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
}

/** Helper: builds Authorization header if a token exists */
export function authHeader(): Record<string, string> {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
