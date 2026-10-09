import React, { useEffect, useState, useMemo } from "react";
import { Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { setSystemTimeZone } from "../../utils/date";

import type { SetupViewProps, ClientInfo } from "./types";
import { useIsMobile } from "../../hooks/useIsMobile";
import { SetupHeader } from "./components/SetupHeader";
import { VerifyConnectionCard } from "./components/VerifyConnectionCard";
import { AccessPointCard } from "./components/AccessPointCard";
import { DohUrlCard } from "./components/DohUrlCard";
import { SetupTabs } from "./components/SetupTabs";
import { AccessPointDrawer } from "./components/AccessPointDrawer";
import type { AccessPoint } from "../../types/auth";
import {
  getClientInfo,
  getTraceInfo,
  getProfileAccessPoints,
  getProfileDetails,
  getDomainGeoLocation,
  resolveDomainDnsIps,
  isDummyOrPlaceholderDomain,
} from "../../services";

export const SetupView: React.FC<SetupViewProps> = ({ profileId, profileKey, profileName, toasterRef }) => {
  const isMobile = useIsMobile();
  const { t } = useTranslation();

  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [loadingAccessPoints, setLoadingAccessPoints] = useState(false);
  const [isAccessPointDrawerOpen, setIsAccessPointDrawerOpen] = useState(false);
  const [selectedApId, setSelectedApId] = useState<string | null>(null);

  const fetchAccessPoints = async () => {
    setLoadingAccessPoints(true);
    try {
      const data = await getProfileAccessPoints(profileId);
      setAccessPoints(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAccessPoints(false);
    }
  };

  useEffect(() => {
    fetchAccessPoints();
  }, [profileId]);

  const [currentProfileName, setCurrentProfileName] = useState<string>(profileName || "");

  useEffect(() => {
    if (profileName) {
      setCurrentProfileName(profileName);
    } else if (profileId) {
      getProfileDetails(profileId)
        .then((data: any) => {
          if (data?.name) setCurrentProfileName(data.name);
        })
        .catch(() => {});
    }
  }, [profileId, profileName]);

  const activeAp = useMemo(() => {
    if (accessPoints.length === 0) return null;
    return accessPoints.find(ap => ap.id === selectedApId) || accessPoints[0];
  }, [accessPoints, selectedApId]);

  const activeToken = activeAp ? activeAp.token : profileKey;
  const activeName = activeAp ? activeAp.name : undefined;
  const dohUrl = `${window.location.origin}/${activeToken}`;
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [showIp, setShowIp] = useState(false);
  const [showLocation, setShowLocation] = useState(false);
  const [traceInfo, setTraceInfo] = useState<{ colo: string; raw: string } | null>(null);
  const [edgeLocation, setEdgeLocation] = useState<string | null>(null);
  const [domainIps, setDomainIps] = useState<{ ipv4: string[]; ipv6: string[] }>({ ipv4: [], ipv6: [] });
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; profileMatch: boolean } | null>(null);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toasterRef?.current?.show({
      message: t("setup.copied"),
      intent: Intent.SUCCESS,
    });
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const [clientData, traceResult] = await Promise.all([
        getClientInfo(),
        getTraceInfo(),
      ]);

      setClientInfo(clientData);
      setTraceInfo(traceResult);

      if (clientData.timezone && clientData.timezone !== "UNKNOWN") {
        setSystemTimeZone(clientData.timezone);
      }

      // Determine active target domain for DNS IP resolution & Geo location
      // Avoid RFC 2606 dummy placeholders (e.g. dns.example.com)
      const isLocalHost = (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname === "::1" ||
        window.location.hostname.startsWith("192.168.") ||
        window.location.hostname.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(window.location.hostname)
      );

      const hasValidDotDomain = Boolean(
        clientData.dotDomain && !isDummyOrPlaceholderDomain(clientData.dotDomain)
      );

      const domainToResolve = (isLocalHost && hasValidDotDomain)
        ? clientData.dotDomain!
        : (hasValidDotDomain ? clientData.dotDomain! : (window.location.hostname || ""));

      // Fetch geographic location of the current domain from the frontend
      getDomainGeoLocation(domainToResolve)
        .then((loc) => setEdgeLocation(loc))
        .catch((e) => console.warn("Failed fetching domain geo location:", e));

      // Resolve IPv4 and IPv6 addresses for the current domain
      resolveDomainDnsIps(domainToResolve)
        .then((ips) => setDomainIps(ips))
        .catch((e) => console.warn("Failed resolving domain DNS IPs:", e));

      setVerifyResult({
        success: !!clientData.connectedProfileId,
        profileMatch: clientData.connectedProfileId === profileId,
      });
    } catch (e) {
      console.error("Verification failed", e);
    } finally {
      setIsVerifying(false);
    }
  };

  useEffect(() => {
    handleVerify();
  }, [profileId]); // Ensure it only runs once unless profileId changes

  // DNS IPs resolved directly from current domain (IPv4 and IPv6)
  const currentIps = useMemo(() => {
    const list: { ip: string; area: string | null }[] = [];

    for (const ip of domainIps.ipv4) {
      list.push({
        ip,
        area: "IPv4",
      });
    }
    for (const ip of domainIps.ipv6) {
      list.push({
        ip,
        area: "IPv6",
      });
    }

    return list;
  }, [domainIps]);

  return (
    <div className={`mx-auto space-y-8 pb-24 ${isMobile ? "p-1" : "px-8 max-w-5xl"}`}>
      <SetupHeader isMobile={isMobile} />

      <VerifyConnectionCard
        isVerifying={isVerifying}
        verifyResult={verifyResult}
        handleVerify={handleVerify}
        isMobile={isMobile}
        clientInfo={clientInfo}
        showIp={showIp}
        setShowIp={setShowIp}
        showLocation={showLocation}
        setShowLocation={setShowLocation}
        traceInfo={traceInfo}
        edgeLocation={edgeLocation}
      />

      <AccessPointCard
        accessPoints={accessPoints}
        selectedApId={activeAp?.id || null}
        onSelectAp={setSelectedApId}
        accessPointName={activeName}
        onManageAccessPoints={() => setIsAccessPointDrawerOpen(true)}
        isMobile={isMobile}
      />

      <DohUrlCard 
        dohUrl={dohUrl} 
        copyToClipboard={copyToClipboard} 
        isMobile={isMobile} 
      />

      <SetupTabs
        isMobile={isMobile}
        copyToClipboard={copyToClipboard}
        profileKey={activeToken}
        profileName={currentProfileName || undefined}
        accessPointName={activeName}
        currentIps={currentIps}
        dotDomain={clientInfo?.dotDomain}
      />

      <AccessPointDrawer
        isOpen={isAccessPointDrawerOpen}
        onClose={() => setIsAccessPointDrawerOpen(false)}
        profileId={profileId}
        isMobile={isMobile}
        accessPoints={accessPoints}
        loading={loadingAccessPoints}
        onRefresh={fetchAccessPoints}
        toasterRef={toasterRef as any}
      />
    </div>
  );
};
