import { lazyNamed } from "../../app/lazy";
// The plugin's ribbon button (cheap: an icon and a callback; the Hub itself stays lazy).
import "./ribbon";

export const HubView = lazyNamed(() => import("./HubView"), "HubView");
