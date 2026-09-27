// The spreadsheet function library (formula.js, ~400 functions) is large, so it's loaded
// on first use instead of with the app. Until it arrives, function calls evaluate to
// Excel's #BUSY!; views that show formulas re-render when it's ready.

type Library = Record<string, unknown>;

let library: Library | null = null;
let loading: Promise<Library> | null = null;
const listeners = new Set<() => void>();

export function loadFunctions(): Promise<Library> {
  loading ??= import("@formulajs/formulajs").then((m) => {
    library = m as unknown as Library;
    listeners.forEach((l) => l());
    return library;
  });
  return loading;
}

/** The library if loaded (starts loading it otherwise). */
export function functions(): Library | null {
  if (!library) void loadFunctions();
  return library;
}

export function onFunctionsLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const functionsReady = () => library !== null;
