import { ehDono } from "../lib/config.js";

export const papelDe = (ids = []) => (ehDono(...ids) ? "dono" : null);
