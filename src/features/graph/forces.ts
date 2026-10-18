import type { ForceLink, Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import type { ForceSettings } from "./graphSettings";

// The graph view's physics: a d3-force simulation with Obsidian's four controls. It
// cools down and stops by itself, so a settled graph costs nothing while idle.

export type D3Force = typeof import("d3-force");

export interface SimNode extends SimulationNodeDatum {
  id: string;
}
export type SimLink = SimulationLinkDatum<SimNode>;
export type GraphSimulation = Simulation<SimNode, SimLink>;

/** Graphs above this size trade some accuracy for speed. */
const LARGE = 1500;

/** Apply the four sliders to a simulation's forces (the simulation isn't restarted). */
export function applyForces(d3: D3Force, sim: GraphSimulation, f: ForceSettings, n: number) {
  const degree = new Map<string, number>();
  const links = sim.force<ForceLink<SimNode, SimLink>>("link")?.links() ?? [];
  const id = (end: string | number | SimNode) => (typeof end === "object" ? end.id : String(end));
  for (const l of links) {
    degree.set(id(l.source), (degree.get(id(l.source)) ?? 0) + 1);
    degree.set(id(l.target), (degree.get(id(l.target)) ?? 0) + 1);
  }
  const charge = d3.forceManyBody<SimNode>().strength(-f.repel * 12);
  if (n > LARGE) charge.theta(1.2).distanceMax(600);
  sim
    .force("charge", charge)
    .force("x", d3.forceX<SimNode>(0).strength(f.center * 0.15))
    .force("y", d3.forceY<SimNode>(0).strength(f.center * 0.15))
    .force(
      "link",
      d3
        .forceLink<SimNode, SimLink>(links)
        .id((d) => d.id)
        .distance(f.linkDistance / 5)
        .strength(
          (l) =>
            f.linkForce /
            Math.max(1, Math.min(degree.get(id(l.source)) ?? 1, degree.get(id(l.target)) ?? 1)),
        ),
    );
}

/** A stopped simulation over `nodes` and `links`; the caller ticks or restarts it. */
export function createSimulation(
  d3: D3Force,
  nodes: SimNode[],
  links: SimLink[],
  f: ForceSettings,
): GraphSimulation {
  const sim = d3
    .forceSimulation<SimNode, SimLink>(nodes)
    .force(
      "link",
      d3.forceLink<SimNode, SimLink>(links).id((d) => d.id),
    )
    .stop();
  if (nodes.length > LARGE) sim.alphaDecay(0.05);
  applyForces(d3, sim, f, nodes.length);
  return sim;
}

/** Run the simulation synchronously for at most `budgetMs` (or until it settles). */
export function preTick(sim: GraphSimulation, budgetMs: number, maxTicks = 300): number {
  const start = performance.now();
  let ticks = 0;
  while (ticks < maxTicks && sim.alpha() > sim.alphaMin() && performance.now() - start < budgetMs) {
    sim.tick();
    ticks++;
  }
  return ticks;
}
