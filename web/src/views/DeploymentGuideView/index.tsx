import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, Elevation, Button, Intent, Tabs, Tab, Callout } from "@blueprintjs/core";
import { RefreshCw, Terminal, Cloud } from "lucide-react";
import { LanguageSwitcher } from "../../components/LanguageSwitcher";
import { ScrollingIntro } from "../../components/ScrollingIntro";
import LogoIcon from "../../assets/obex_cat_eye_logo-256.webp";
import { CliGuide } from "./components/CliGuide";
import { DashboardGuide } from "./components/DashboardGuide";
import { JwtGenerator } from "./components/JwtGenerator";

export const DeploymentGuideView: React.FC = () => {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>("cli");
  const [isPanelVisible, setIsPanelVisible] = useState(true);

  // Read status injected from HTMLRewriter
  const isDbMissing = (window as any).OBEX_CONFIG?.isDbMissing ?? true;
  const isJwtSecretMissing = (window as any).OBEX_CONFIG?.isJwtSecretMissing ?? true;

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="flex flex-row min-h-screen bg-white dark:bg-gray-950 overflow-hidden relative">
      {/* Scroll Intro Sidebar (Left Panel) */}
      <div className="hidden lg:block w-1/2 h-screen overflow-hidden border-r border-gray-100 dark:border-gray-900">
        <ScrollingIntro />
      </div>

      {/* Floating Scroll Intro Sidebar for Mobile view */}
      <div
        className={`lg:hidden absolute inset-0 z-0 transition-opacity duration-500 cursor-pointer ${
          isPanelVisible ? "opacity-25" : "opacity-70"
        }`}
        onClick={() => setIsPanelVisible(true)}
      >
        <ScrollingIntro />
      </div>

      {!isPanelVisible && (
        <div className="lg:hidden fixed bottom-12 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <Button
            large
            intent="primary"
            icon="manual"
            text={t("deploymentGuide.title")}
            onClick={() => setIsPanelVisible(true)}
            className="shadow-2xl px-8 py-4 rounded-full"
          />
        </div>
      )}

      {/* Guide Container Card (Right Panel) */}
      <div
        className={`flex-1 flex items-center justify-center p-4 relative z-10 bg-gray-50/50 dark:bg-gray-900/30 lg:bg-gray-50 lg:dark:bg-gray-900/50 transition-all duration-500 ease-in-out ${
          !isPanelVisible ? "max-lg:translate-x-full max-lg:opacity-0 max-lg:pointer-events-none" : "translate-x-0 opacity-100"
        }`}
        onClick={(e) => {
          if (window.innerWidth < 1024 && e.target === e.currentTarget) {
            setIsPanelVisible(false);
          }
        }}
      >
        {/* Language Switcher */}
        <div className="absolute top-4 right-4 z-50">
          <LanguageSwitcher />
        </div>

        <div className="w-full max-w-2xl transition-all duration-200 ease-in-out transform-gpu">
          <Card
            elevation={Elevation.FOUR}
            className="w-full max-h-[90vh] flex flex-col p-6 md:p-8 rounded-2xl border border-gray-100 dark:border-gray-800 dark:bg-gray-900 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Brand Header (Fixed Top) */}
            <div className="flex items-center gap-4 mb-6 shrink-0">
              <img src={LogoIcon} alt="DNS Worker Logo" className="w-10 h-10 object-contain rounded-xl shadow-lg shadow-blue-500/10" />
              <div>
                <h1 className="text-xl font-extrabold text-gray-900 dark:text-zinc-50 tracking-tight m-0">DNS Worker</h1>
                <p className="text-xs text-gray-500 dark:text-zinc-400 font-medium m-0 mt-0.5">Advanced Agentic DNS Server</p>
              </div>
            </div>

            {/* Scrollable Middle Content */}
            <div className="flex-1 overflow-y-auto pr-1.5 min-h-0 space-y-6 scrollbar-thin">
              {/* Content Title */}
              <div>
                <h2 className="text-lg md:text-xl font-bold text-gray-900 dark:text-zinc-50 mb-1 mt-0">
                  {t("deploymentGuide.title")}
                </h2>
                <p className="text-gray-600 dark:text-zinc-400 text-xs md:text-sm leading-relaxed m-0">
                  {t("deploymentGuide.subtitle")}
                </p>
              </div>

              {/* Status Section */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* DB Status Callout */}
                <Callout
                  intent={isDbMissing ? Intent.DANGER : Intent.SUCCESS}
                  icon={isDbMissing ? "warning-sign" : "tick"}
                  title={t("deploymentGuide.dbStatus")}
                  className="flex-1"
                >
                  <span className="font-semibold text-xs">
                    {isDbMissing ? t("deploymentGuide.missing") : t("deploymentGuide.configured")}
                  </span>
                </Callout>

                {/* JWT Status Callout */}
                <Callout
                  intent={isJwtSecretMissing ? Intent.DANGER : Intent.SUCCESS}
                  icon={isJwtSecretMissing ? "warning-sign" : "tick"}
                  title={t("deploymentGuide.jwtStatus")}
                  className="flex-1"
                >
                  <span className="font-semibold text-xs">
                    {isJwtSecretMissing ? t("deploymentGuide.missing") : t("deploymentGuide.configured")}
                  </span>
                </Callout>
              </div>

              {/* JWT Secret Generator */}
              <JwtGenerator />

              {/* Deployment Methods Tabs */}
              <div>
                <Tabs
                  id="deploy-methods"
                  selectedTabId={activeTab}
                  onChange={(id) => setActiveTab(id as string)}
                  className="border-b border-gray-200 dark:border-zinc-800 pb-2"
                >
                  <Tab
                    id="cli"
                    title={
                      <div className="flex items-center gap-2 font-bold py-1.5 px-1">
                        <Terminal size={14} />
                        <span>{t("deploymentGuide.methodCli")}</span>
                      </div>
                    }
                  />
                  <Tab
                    id="dash"
                    title={
                      <div className="flex items-center gap-2 font-bold py-1.5 px-1">
                        <Cloud size={14} />
                        <span>{t("deploymentGuide.methodDash")}</span>
                      </div>
                    }
                  />
                </Tabs>
              </div>

              {/* Dynamic Setup Guides */}
              <div className="space-y-6 pb-2">
                {activeTab === "cli" ? <CliGuide /> : <DashboardGuide />}
              </div>
            </div>

            {/* Footer Actions (Fixed Bottom) */}
            <div className="flex items-center justify-end border-t border-gray-200 dark:border-zinc-800 pt-4 shrink-0 mt-4">
              <Button
                large
                intent={Intent.PRIMARY}
                icon={<RefreshCw size={14} className="animate-spin-hover" />}
                text={t("deploymentGuide.refresh")}
                onClick={handleRefresh}
              />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
