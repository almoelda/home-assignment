import { Navigate } from "react-router";
import { useIdentity } from "../state/IdentityContext.js";

export function Home() {
  const { identity } = useIdentity();

  if (identity?.role === "advertiser") return <Navigate to="/advertiser/campaigns" replace />;
  if (identity?.role === "creator") return <Navigate to="/creator/opportunities" replace />;

  return <p className="text-muted-foreground">Pick who you're acting as above to get started.</p>;
}
