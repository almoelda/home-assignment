import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client.js";
import type { IdentitiesResponse } from "../api/types.js";
import { useIdentity, type Identity } from "../state/IdentityContext.js";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

function encodeValue(identity: Identity): string {
  return `${identity.role}:${identity.id}`;
}

export function IdentitySwitcher() {
  const { identity, setIdentity } = useIdentity();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["identities"],
    queryFn: () => apiFetch<IdentitiesResponse>("/identities"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2">
        <Label>Acting as:</Label>
        <Skeleton className="h-9 w-56" />
      </div>
    );
  }
  if (isError || !data) {
    return <span className="text-sm text-destructive">Could not load identities</span>;
  }

  const handleChange = (value: string) => {
    const [role, idStr] = value.split(":");
    const id = Number(idStr);
    if (role === "advertiser") {
      const advertiser = data.advertisers.find((a) => a.id === id);
      if (advertiser) setIdentity({ role: "advertiser", id, label: advertiser.name });
    } else if (role === "creator") {
      const creator = data.creators.find((c) => c.id === id);
      if (creator) setIdentity({ role: "creator", id, label: `${creator.displayName} (@${creator.handle})` });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="identity-select">Acting as:</Label>
      <Select {...(identity ? { value: encodeValue(identity) } : {})} onValueChange={handleChange}>
        <SelectTrigger id="identity-select" aria-label="Acting as:" className="w-64">
          <SelectValue placeholder="— choose who you are —" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Advertisers</SelectLabel>
            {data.advertisers.map((a) => (
              <SelectItem key={`advertiser:${a.id}`} value={`advertiser:${a.id}`}>
                {a.name}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Creators</SelectLabel>
            {data.creators.map((c) => (
              <SelectItem key={`creator:${c.id}`} value={`creator:${c.id}`}>
                {c.displayName} (@{c.handle} · {c.platform} · {c.genre})
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
