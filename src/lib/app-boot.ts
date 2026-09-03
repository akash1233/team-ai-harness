/** Vite injects a new value each time the dev/preview process starts. Tests fall back to "test". */
export function getAppBootId(): string {
  try {
    const id = import.meta.env?.VITE_KINDLING_BOOT_ID;
    return typeof id === "string" && id ? id : "test";
  } catch {
    return "test";
  }
}
