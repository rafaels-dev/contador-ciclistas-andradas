/** localStorage keys before 0.0.8 → the current ones. */
export const LEGACY_STORAGE: Record<string, string> = {
  "contador:tema": "tc:theme",
  "contador:alturaTimeline": "tc:timelineHeight",
  "contador:ultima-pasta": "tc:lastFolder",
};

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Moves each old key to its new name (a value already saved under the new
 * name wins) and removes the old one. Runs inside the layout's inline script,
 * as source text: it must not use anything from outside the function.
 */
export function moveStorageKeys(s: KeyStore, keys: Record<string, string>): void {
  for (const old in keys) {
    const v = s.getItem(old);
    if (v === null) continue;
    if (s.getItem(keys[old]) === null) s.setItem(keys[old], v);
    s.removeItem(old);
  }
}
