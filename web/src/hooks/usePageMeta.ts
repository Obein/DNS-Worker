import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";

/**
 * Custom hook to generate localized page title and SEO meta description based on the current location.
 */
export function usePageMeta() {
  const { t } = useTranslation();
  const location = useLocation();

  const getPageMeta = (path: string) => {
    let moduleName = "";
    let description = t(
      "meta.defaultDesc",
      "Secure, fast, and customizable DNS resolution for all your devices. Based on Cloudflare Workers. Open-source and privacy-focused."
    );

    if (path === "/dash") {
      moduleName = t("common.selectProfile");
    } else if (path === "/account") {
      moduleName = t("common.account");
    } else if (path.endsWith("/setup")) {
      moduleName = t("nav.setup");
      description = t("meta.setupDesc", "Configure your devices to use DNS Worker.");
    } else if (path.endsWith("/filter")) {
      moduleName = t("nav.filter");
    } else if (path.endsWith("/rules")) {
      moduleName = t("nav.rules");
    } else if (path.endsWith("/settings")) {
      moduleName = t("nav.settings");
    } else if (path.endsWith("/stats")) {
      moduleName = t("nav.stats");
    } else if (path.endsWith("/logs")) {
      moduleName = t("nav.logs");
    }

    const title = moduleName ? `${moduleName} | DNS Worker` : "DNS Worker";
    return { title, description };
  };

  return getPageMeta(location.pathname);
}
