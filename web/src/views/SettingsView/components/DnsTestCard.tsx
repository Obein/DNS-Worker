import React from "react";
import { Card, Elevation, H5, FormGroup, InputGroup, HTMLSelect, Button, Intent, Tag, Divider, Callout } from "@blueprintjs/core";
import { Zap, MapPin, Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {  TestResponse  } from "../types";

export interface DnsTestCardProps {
  testInput: { domain: string; type: string };
  setTestInput: (input: { domain: string; type: string }) => void;
  handleDnsTest: () => void;
  testing: boolean;
  testResult: TestResponse | null;
}

export const DnsTestCard: React.FC<DnsTestCardProps> = ({ testInput, setTestInput, handleDnsTest, testing, testResult }) => {
  const { t } = useTranslation();

  return (
    <Card elevation={Elevation.TWO} className="dark:bg-gray-900 border-t-2 border-blue-500">
      <H5 className="flex items-center gap-2 mb-6 font-bold">
        <Zap size={20} className="text-yellow-500 fill-yellow-500" /> {t("settings.testToolTitle")}
      </H5>

      <div className="flex flex-col space-y-6">
        <div className="flex gap-4">
          <FormGroup label={t("settings.testDomain")} className="flex-1 mb-0">
            <InputGroup
              fill
              large
              placeholder={t("settings.domainPlaceholder")}
              value={testInput.domain}
              onChange={(e) => setTestInput({ ...testInput, domain: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleDnsTest()}
            />
          </FormGroup>
          <FormGroup label={t("settings.recordType")} className="w-32 mb-0">
            <HTMLSelect
              fill
              large
              value={testInput.type}
              onChange={(e) => setTestInput({ ...testInput, type: e.target.value })}
            >
              <option value="A">A</option>
              <option value="AAAA">AAAA</option>
              <option value="CNAME">CNAME</option>
              <option value="TXT">TXT</option>
            </HTMLSelect>
          </FormGroup>
          <FormGroup label={"\u00A0"} className="mb-0">
            <Button size="large" intent={Intent.PRIMARY} icon="search" text={t("settings.runTest")} onClick={handleDnsTest} loading={testing} />
          </FormGroup>
        </div>

        {testResult && (
          <div className="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl border border-gray-100 dark:border-gray-800 space-y-6 animate-in fade-in slide-in-from-top-4">
            <div className="flex flex-wrap gap-4 items-center">
              <Tag
                large
                round
                intent={testResult.action === "PASS" ? Intent.SUCCESS : testResult.action === "BLOCK" ? Intent.DANGER : Intent.WARNING}
                className="px-4 font-bold"
              >
                {testResult.action}
              </Tag>
              <div className="flex flex-col">
                <span className="text-[10px] uppercase font-bold opacity-40">{t("settings.hitRule")}</span>
                <span className="text-sm font-bold">{testResult.reason || t("settings.defaultAllow")}</span>
              </div>
              <div className="flex flex-col border-l border-gray-200 dark:border-gray-700 pl-4">
                <span className="text-[10px] uppercase font-bold opacity-40">{t("settings.parseLatency")}</span>
                <span className="text-sm font-mono font-bold">{testResult.latency ? `${testResult.latency}ms` : "-"}</span>
              </div>
              {testResult.timings && (
                <div className="flex flex-wrap gap-x-4 gap-y-1 border-l border-gray-200 dark:border-gray-700 pl-4 max-w-md">
                  {Object.entries(testResult.timings).map(([stage, ms]) => (
                    <div key={stage} className="flex gap-1 items-baseline">
                      <span className="text-[9px] opacity-40 uppercase font-mono">{stage}:</span>
                      <span className="text-[10px] font-mono font-bold">{ms}ms</span>
                    </div>
                  ))}
                </div>
              )}
              <Divider />
              <div className="flex items-center gap-2 bg-white dark:bg-gray-900 px-3 py-1.5 rounded-lg shadow-sm border border-gray-100 dark:border-gray-800">
                <MapPin size={14} className="text-red-500" />
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-bold opacity-40 leading-none">{t("settings.sourceIp")}</span>
                  <span className="text-xs font-mono">
                    {testResult.client_ip} ({testResult.geo_country})
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="text-[10px] uppercase font-bold opacity-40 flex items-center gap-1">
                <Activity size={10} /> {t("settings.answerSection")}
              </div>
              <div className="font-mono text-sm leading-relaxed bg-white dark:bg-gray-900 p-4 rounded-xl border border-gray-100 dark:border-gray-800 shadow-inner">
                {testResult.answers && testResult.answers.length > 0 ? (
                  testResult.answers.map((a: any, i: number) => (
                    <div key={i} className="flex gap-4 py-1 border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 transition-colors px-2">
                      <span className="w-16 font-bold text-blue-500">{a.type}</span>
                      <span className="flex-1 dark:text-gray-300">{a.data}</span>
                      <span className="text-[10px] opacity-30 italic">TTL: {a.ttl}s</span>
                    </div>
                  ))
                ) : (
                  <div className="p-4 opacity-40 italic text-center">{t("settings.noRecordsReturned")}</div>
                )}
              </div>
            </div>

            {testResult.diagnostics && (
              <Callout minimal intent={Intent.NONE} className="text-xs font-mono opacity-80">
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between">
                    <span className="font-bold">{t("settings.diagnostics")}</span>
                    <span>HTTP {testResult.diagnostics.status}</span>
                  </div>
                  <div className="break-all">{testResult.diagnostics.upstream_url}</div>
                </div>
              </Callout>
            )}
          </div>
        )}
      </div>
    </Card>
  );
};
