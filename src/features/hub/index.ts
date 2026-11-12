import { lazyNamed } from "../../app/lazy";

export const HubView = lazyNamed(() => import("./HubView"), "HubView");
