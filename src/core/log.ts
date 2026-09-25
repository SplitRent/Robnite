/** Namespaced logging so problems are easy to locate in the console. */
export function logger(system: string) {
  const tag = `[Robnite][${system}]`;
  return {
    info: (...args: unknown[]) => console.info(tag, ...args),
    warn: (...args: unknown[]) => console.warn(tag, ...args),
    error: (...args: unknown[]) => console.error(tag, ...args),
  };
}
