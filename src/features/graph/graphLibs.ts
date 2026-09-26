// Loads the graph rendering libraries on first use. Kept in its own module so the code
// is split out of the startup bundle and tests can substitute a WebGL-free stand-in.

export async function loadGraphLibs() {
  const [{ default: Sigma }, { default: forceAtlas2 }, { default: FA2Layout }] = await Promise.all([
    import("sigma"),
    import("graphology-layout-forceatlas2"),
    import("graphology-layout-forceatlas2/worker"),
  ]);
  return { Sigma, forceAtlas2, FA2Layout };
}
