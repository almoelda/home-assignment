import type { FastifyRequest } from "fastify";

export type Actor = { role: "advertiser"; id: number } | { role: "creator"; id: number };

/**
 * X-Actor-Role / X-Actor-Id (plan §5, §7). NOT security — there is no auth in this project
 * (brief: "The user picks who they're acting as"). This is a soft hint the UI sends to say
 * who it's pretending to be; the API trusts it. Documented plainly in the README.
 */
export function getActor(request: FastifyRequest): Actor | null {
  const role = request.headers["x-actor-role"];
  const idRaw = request.headers["x-actor-id"];
  if (role !== "advertiser" && role !== "creator") return null;
  if (typeof idRaw !== "string") return null;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { role, id };
}
