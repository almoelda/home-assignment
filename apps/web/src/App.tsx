import type { ReactNode } from "react";
import { Link, Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "./components/ErrorBoundary.js";
import { IdentitySwitcher } from "./components/IdentitySwitcher.js";
import { CampaignDetail } from "./pages/CampaignDetail.js";
import { Home } from "./pages/Home.js";
import { CreateCampaign } from "./pages/advertiser/CreateCampaign.js";
import { MyCampaigns } from "./pages/advertiser/MyCampaigns.js";
import { MyBids } from "./pages/creator/MyBids.js";
import { Opportunities } from "./pages/creator/Opportunities.js";
import { useIdentity } from "./state/IdentityContext.js";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  const active = location.pathname === to;
  return (
    <Button asChild variant="ghost" size="sm" className={cn(active && "bg-accent text-accent-foreground")}>
      <Link to={to}>{children}</Link>
    </Button>
  );
}

function Nav() {
  const { identity } = useIdentity();
  if (identity?.role === "advertiser") {
    return (
      <nav className="flex gap-1 border-b bg-background px-6 py-2">
        <NavLink to="/advertiser/campaigns">My Campaigns</NavLink>
      </nav>
    );
  }
  if (identity?.role === "creator") {
    return (
      <nav className="flex gap-1 border-b bg-background px-6 py-2">
        <NavLink to="/creator/opportunities">Opportunities</NavLink>
        <NavLink to="/creator/bids">My Bids</NavLink>
      </nav>
    );
  }
  return null;
}

export function App() {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background px-6 py-4 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight">Creator Marketplace</h1>
        <IdentitySwitcher />
      </header>
      <Nav />
      <main className="mx-auto max-w-5xl px-6 py-8">
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/advertiser/campaigns" element={<MyCampaigns />} />
            <Route path="/advertiser/campaigns/new" element={<CreateCampaign />} />
            <Route path="/creator/opportunities" element={<Opportunities />} />
            <Route path="/creator/bids" element={<MyBids />} />
            <Route path="/campaigns/:id" element={<CampaignDetail />} />
            <Route path="*" element={<p className="text-muted-foreground">Page not found.</p>} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
