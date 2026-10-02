export interface AdvertiserIdentity {
  id: number;
  name: string;
}

export interface CreatorIdentity {
  id: number;
  handle: string;
  displayName: string;
  platform: "tiktok" | "instagram";
  genre: string;
}

export interface IdentitiesResponse {
  advertisers: AdvertiserIdentity[];
  creators: CreatorIdentity[];
}
