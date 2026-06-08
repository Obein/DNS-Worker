import React, { useEffect, useState, useMemo } from "react";
import { Intent } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { getPresetRegions, type RegionConfigItem } from "../../config/regions";

import type {  SetupViewProps, DebugInfo  } from "./types";
import { useIsMobile } from "./utils";
import { SetupHeader } from "./components/SetupHeader";
import { VerifyConnectionCard } from "./components/VerifyConnectionCard";
import { DohUrlCard } from "./components/DohUrlCard";
import { SetupTabs } from "./components/SetupTabs";

export const SetupView: React.FC<SetupViewProps> = ({ profileId, profileKey, toasterRef }) => {
  const isMobile = useIsMobile();
  const { t, i18n } = useTranslation();
  const presetRegions = useMemo(() => getPresetRegions(t), [i18n.language, t]);
  const dohUrl = `${window.location.origin}/${profileKey}`;
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
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
    try {
      const res = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
        headers: { Accept: "application/dns-json" },
      });
      const res6 = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=AAAA`, {
        headers: { Accept: "application/dns-json" },
      });
      const data = await res.json();
      const data6 = await res6.json();
      if (data.Answer && data.Answer.length > 0) {
        const aRecord = data.Answer.find((a: any) => a.type === 1);
        if (aRecord) setSubstituteDomainIp(aRecord.data);
      }
      if (data6.Answer && data6.Answer.length > 0) {
        const aaaaRecord = data6.Answer.find((a: any) => a.type === 28);
        if (aaaaRecord) setSubstituteDomainIpv6(aaaaRecord.data);
      }
    } catch (e) {
      console.error(`Failed to resolve ${domain}`, e);
    }
  };

  const handleVerify = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const debugRes = await fetch("/api/debug");
      const debugData = await debugRes.json();
      setDebugInfo(debugData);

      const domainToResolve = debugData.substituteDomain || "pages.dev";
      resolveSubstituteDomain(domainToResolve);

      if (debugData.regions) {
        const enriched: Record<string, RegionConfigItem> = {};
        for (const [key, ips] of Object.entries(debugData.regions)) {
          enriched[key] = {
            label: presetRegions[key]?.label || key,
            countries: presetRegions[key]?.countries || [],
            ips: ips as any,
          };
        }
        setServerRegions(enriched);
      }

      if (debugData.country) {
        let matched = false;
        for (const [key, config] of Object.entries(presetRegions)) {
          if (config.countries.includes(debugData.country)) {
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
        success: !!debugData.connectedProfileId,
        profileMatch: debugData.connectedProfileId === profileId,
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
    const domain = debugInfo?.substituteDomain || "pages.dev";
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
  }, [selectedRegion, allRegions, substituteDomainIp, substituteDomainIpv6, debugInfo, t, OTHER_REGION]);

  return (
    <div className={`mx-auto space-y-8 pb-24 ${isMobile ? "p-4" : "p-8 max-w-5xl"}`}>
      <SetupHeader isMobile={isMobile} selectedRegion={selectedRegion} setSelectedRegion={setSelectedRegion} allRegions={allRegions} />

      <VerifyConnectionCard
        isVerifying={isVerifying}
        verifyResult={verifyResult}
        handleVerify={handleVerify}
        isMobile={isMobile}
        debugInfo={debugInfo}
        showIp={showIp}
        setShowIp={setShowIp}
      />

      <DohUrlCard dohUrl={dohUrl} copyToClipboard={copyToClipboard} isMobile={isMobile} />

      <SetupTabs
        isMobile={isMobile}
        copyToClipboard={copyToClipboard}
        profileKey={profileKey}
        allRegions={allRegions}
        selectedRegion={selectedRegion}
        currentIps={currentIps}
      />
    </div>
  );
};
