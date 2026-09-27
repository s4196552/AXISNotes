import { type ComponentType, lazy } from "react";

/** `React.lazy` for a named export: `lazyNamed(() => import("./X"), "X")`. */
export function lazyNamed<M, K extends keyof M>(load: () => Promise<M>, name: K): M[K] {
  return lazy(async () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    default: (await load())[name] as ComponentType<any>,
  })) as M[K];
}
