import { OverlayToaster } from "@blueprintjs/core";

export interface SetupViewProps {
  profileId: string;
  profileKey: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export interface ClientInfo {
  ip: string;
  country: string;
  region?: string;
  city: string;
  timezone?: string;
  asn: number;
  asOrganization: string;
  connectedProfileId?: string;
  substituteDomain?: string;
}
