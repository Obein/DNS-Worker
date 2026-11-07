import { OverlayToaster } from "@blueprintjs/core";
import React from "react";

export interface FilteringViewProps {
  profileId: string;
  toasterRef?: React.RefObject<OverlayToaster | null>;
}

export interface FilterList {
  id: number;
  url: string;
  last_synced_at?: number;
  last_modified?: number | null;
  etag?: string | null;
  enabled: boolean;
  is_system?: boolean | number;
  sync_error?: string | null;
}
