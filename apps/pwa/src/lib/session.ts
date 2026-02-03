const KEY = "stashjar_user_id";

export function getUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setUserId(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, id);
}

export function clearUserId() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(KEY);
}
