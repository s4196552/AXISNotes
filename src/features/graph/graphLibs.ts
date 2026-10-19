// Loads the graph rendering libraries on first use. Kept in its own module so the code
// is split out of the startup bundle and tests can substitute a WebGL-free stand-in.

export async function loadGraphLibs() {
  const [{ default: Sigma }, d3] = await Promise.all([import("sigma"), import("d3-force")]);
  return { Sigma, d3 };
}
