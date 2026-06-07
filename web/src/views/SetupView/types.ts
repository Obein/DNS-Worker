import { OverlayToaster } from "@blueprintjs/core";
import type { RegionConfigItem } from "../../config/regions";

export interface SetupViewProps {
  profileId: string;
  profileKey: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export interface DebugInfo {
  ip: string;
  country: string;
  city: string;
  asn: number;
  asOrganization: string;
  connectedProfileId?: string;
  regions?: Record<string, RegionConfigItem>;
  substituteDomain?: string;
}
