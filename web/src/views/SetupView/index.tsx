import React, { useEffect, useState, useMemo } from "react";
import { Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { getPresetRegions, type RegionConfigItem } from "../../config/regions";
import { setSystemTimeZone } from "../../utils/date";

import type {  SetupViewProps, ClientInfo  } from "./types";
import { useIsMobile } from "./utils";
import { SetupHeader } from "./components/SetupHeader";
import { VerifyConnectionCard } from "./components/VerifyConnectionCard";
import { DohUrlCard } from "./components/DohUrlCard";
import { SetupTabs } from "./components/SetupTabs";
import { AccessPointDrawer } from "./components/AccessPointDrawer";
import type { AccessPoint } from "../../types/auth";

export const SetupView: React.FC<SetupViewProps> = ({ profileId, profileKey, toasterRef }) => {
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const presetRegions = useMemo(() => getPresetRegions(t), [i18n.language, t]);
  
  const [accessPoints, setAccessPoints] = useState<AccessPoint[]>([]);
  const [loadingAccessPoints, setLoadingAccessPoints] = useState(false);
  const [isAccessPointDrawerOpen, setIsAccessPointDrawerOpen] = useState(false);
  const [selectedApId, setSelectedApId] = useState<string | null>(null);

  const fetchAccessPoints = async () => {
    setLoadingAccessPoints(true);
    try {
      const res = await fetch(`/api/profiles/${profileId}/access_points`);
      if (res.ok) {
        setAccessPoints(await res.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingAccessPoints(false);
    }
  };

  useEffect(() => {
    fetchAccessPoints();
  }, [profileId]);

  const activeAp = useMemo(() => {
    if (accessPoints.length === 0) return null;
    return accessPoints.find(ap => ap.id === selectedApId) || accessPoints[0];
  }, [accessPoints, selectedApId]);

  const activeToken = activeAp ? activeAp.token : profileKey;
  const activeName = activeAp ? activeAp.name : undefined;
  const dohUrl = `${window.location.origin}/${activeToken}`;
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [substituteDomainIp, setSubstituteDomainIp] = useState<string | null>(null);
  const [substituteDomainIpv6, setSubstituteDomainIpv6] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string>("CN");
  const [showIp, setShowIp] = useState(false);
  const [serverRegions, setServerRegions] = useState<Record<string, RegionConfigItem>>({});
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; profileMatch: boolean } | null>(null);

  const OTHER_REGION: RegionConfigItem = {
    label: t("setup.otherRegion"),
    ips: [],
    countries: [],
  };

  const allRegions = useMemo<Record<string, RegionConfigItem>>(() => {
    return { ...presetRegions, ...serverRegions, Other: OTHER_REGION };
  }, [presetRegions, serverRegions, OTHER_REGION]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toasterRef?.current?.show({
      message: t("setup.copied"),
      intent: Intent.SUCCESS,
    });
  };

  const resolveSubstituteDomain = async (domain: string) => {
    const tryResolve = async (server: string, type: string, typeNum: number): Promise<string | null> => {
      try {
        const res = await fetch(`https://${server}/dns-query?name=${domain}&type=${type}`, {
          headers: { Accept: "application/dns-json" },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.Answer && data.Answer.length > 0) {
            const record = data.Answer.find((a: any) => a.type === typeNum);
            if (record?.data) return record.data;
          }
        }
      } catch (e) {
        console.warn(`Client-side DNS query failed for ${domain} (${type}) via ${server}:`, e);
      }
      return null;
    };

    const servers = ["cloudflare-dns.com", "1.1.1.1"];

    // Try resolving A record
    let ipA: string | null = null;
    for (const server of servers) {
      ipA = await tryResolve(server, "A", 1);
      if (ipA) break;
    }
    if (ipA) setSubstituteDomainIp(ipA);

    // Try resolving AAAA record
    let ipAAAA: string | null = null;
    for (const server of servers) {
      ipAAAA = await tryResolve(server, "AAAA", 28);
      if (ipAAAA) break;
    }
    if (ipAAAA) setSubstituteDomainIpv6(ipAAAA);
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const [clientRes, regionsRes] = await Promise.all([
        fetch("/api/clientinfo"),
        fetch("/api/regions"),
      ]);

      const clientData = await clientRes.json();
      const regionsData = await regionsRes.json();
      setClientInfo(clientData);

      if (clientData.timezone && clientData.timezone !== "UNKNOWN") {
        setSystemTimeZone(clientData.timezone);
      }

      const domainToResolve = clientData.substituteDomain || "pages.dev";
      
      try {
        const substituteRes = await fetch("/api/substitute");
        if (substituteRes.ok) {
          const substituteData = await substituteRes.json();
          if (substituteData.ip) {
            setSubstituteDomainIp(substituteData.ip);
          }
          if (substituteData.ipv6) {
            setSubstituteDomainIpv6(substituteData.ipv6);
          }
          
          if (!substituteData.ip || !substituteData.ipv6) {
            resolveSubstituteDomain(domainToResolve);
          }
        } else {
          resolveSubstituteDomain(domainToResolve);
        }
      } catch (e) {
        console.warn("Backend substitute lookup failed, falling back to client-side DNS lookup", e);
        resolveSubstituteDomain(domainToResolve);
      }

      if (regionsData) {
        const enriched: Record<string, RegionConfigItem> = {};
        for (const [key, ips] of Object.entries(regionsData)) {
          enriched[key] = {
            label: presetRegions[key]?.label || key,
            countries: presetRegions[key]?.countries || [],
            ips: ips as any,
          };
        }
        setServerRegions(enriched);
      }

      if (clientData.country) {
        let matched = false;
        for (const [key, config] of Object.entries(presetRegions)) {
          if (config.countries.includes(clientData.country)) {
            setSelectedRegion(key);
            matched = true;
            break;
          }
        }
        if (!matched) {
          setSelectedRegion("Other");
        }
      }

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

  const currentIps = useMemo(() => {
    const region = allRegions[selectedRegion] || OTHER_REGION;
    const baseIps: { ip: string; area: string | null }[] = [...region.ips];
    const domain = clientInfo?.substituteDomain || "pages.dev";
    if (substituteDomainIpv6) {
      baseIps.unshift({
        ip: substituteDomainIpv6,
        area: t("setup.dynamicFromDomainV6", { domain }) as string,
      });
    }
    if (substituteDomainIp) {
      baseIps.unshift({
        ip: substituteDomainIp,
        area: t("setup.dynamicFromDomain", { domain }) as string,
      });
    }
    return baseIps;
  }, [selectedRegion, allRegions, substituteDomainIp, substituteDomainIpv6, clientInfo, t, OTHER_REGION]);

  return (
    <div className={`mx-auto space-y-8 pb-24 ${isMobile ? "p-4" : "p-8 max-w-5xl"}`}>
      <SetupHeader isMobile={isMobile} selectedRegion={selectedRegion} setSelectedRegion={setSelectedRegion} allRegions={allRegions} />

      <VerifyConnectionCard
        isVerifying={isVerifying}
        verifyResult={verifyResult}
        handleVerify={handleVerify}
        isMobile={isMobile}
        clientInfo={clientInfo}
        showIp={showIp}
        setShowIp={setShowIp}
      />

      <DohUrlCard 
        dohUrl={dohUrl} 
        accessPointName={activeName}
        copyToClipboard={copyToClipboard} 
        isMobile={isMobile} 
        onManageAccessPoints={() => setIsAccessPointDrawerOpen(true)}
        accessPoints={accessPoints}
        selectedApId={activeAp?.id || null}
        onSelectAp={setSelectedApId}
      />

      <SetupTabs
        isMobile={isMobile}
        copyToClipboard={copyToClipboard}
        profileKey={activeToken}
        allRegions={allRegions}
        selectedRegion={selectedRegion}
        currentIps={currentIps}
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
