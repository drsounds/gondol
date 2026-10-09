let namespace = "gondol";

/**
 * Sets the namespace of gondol's localStorage keys and window events (`<namespace>:app:active:…`),
 * so an app moving onto gondol keeps what its users already stored.
 */
export function configureStorageNamespace(next: string): void {
  namespace = next;
}

/** `<namespace>:<name>`. Read it when used, not at module load, so the app's namespace applies. */
export function namespaced(name: string): string {
  return `${namespace}:${name}`;
}
