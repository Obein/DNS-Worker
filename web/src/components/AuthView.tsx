import React, { useState, useEffect } from "react";
import { Card, Elevation, Button } from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { clsx } from "clsx";
import { ScrollingIntro } from "./ScrollingIntro";
import { LoginForm } from "./LoginForm";
import { SignupWizard } from "./SignupWizard";
import { loadTurnstileScript } from "../utils/auth";
import { getAuthConfig } from "../services";

/**
 * Authentication configuration settings fetched from server.
 */
export interface AuthConfig {
  turnstile_site_key: string;
  turnstile_enabled_signup: boolean;
  turnstile_enabled_login: boolean;
}

/**
 * Properties for the AuthView component.
 */
interface AuthViewProps {
  /** Callback triggered on successful login or complete signup. */
  onSuccess: () => void;
}

/**
 * AuthView component orchestrates the user login and signup shell.
 * It fetches the environment configuration, dynamically loads the Turnstile script,
 * and displays the ScrollIntro sidebar along with the active authentication card (Login or Signup).
 *
 * @param props - Component props containing the onSuccess callback.
 * @returns React elements representing the full login/registration view.
 */
export const AuthView: React.FC<AuthViewProps> = ({ onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  const [isBlurring, setIsBlurring] = useState(false);
  const { t } = useTranslation();

  const handleToggleMode = () => {
    setIsBlurring(true);
    setTimeout(() => {
      setIsLogin((prev) => !prev);
      setIsBlurring(false);
    }, 300);
  };

  // Dynamic system configuration state
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);

  // Turnstile loading state
  const [turnstileReady, setTurnstileReady] = useState(false);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const configData = await getAuthConfig() as AuthConfig;
        setAuthConfig(configData);
      } catch (e) {
        console.error("Failed to load auth config", e);
      }
    };
    fetchConfig();
  }, []);

  const isTurnstileEnabled = isLogin
    ? authConfig?.turnstile_enabled_login
    : authConfig?.turnstile_enabled_signup;

  useEffect(() => {
    if (isTurnstileEnabled && authConfig?.turnstile_site_key) {
      loadTurnstileScript(() => {
        setTurnstileReady(true);
      });
    }
  }, [isTurnstileEnabled, authConfig]);

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
            icon="log-in"
            text={t("auth.loginBtn")}
            onClick={() => setIsPanelVisible(true)}
            className="shadow-2xl px-8 py-4 rounded-full"
          />
        </div>
      )}

      {/* Form Container Card (Right Panel) */}
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
        <div className="absolute top-4 right-4 z-50">
          <LanguageSwitcher />
        </div>

        <div
          className={clsx(
            "w-full max-w-md transition-all duration-200 ease-in-out transform-gpu",
            isBlurring ? "blur-lg opacity-20 scale-95" : "blur-0 opacity-100 scale-100"
          )}
        >
          <Card
            elevation={Elevation.FOUR}
            className="w-full p-8 rounded-2xl shadow-none! z-10 dark:bg-gray-900 border border-gray-100 dark:border-gray-800"
            onClick={(e) => e.stopPropagation()}
          >
            {isLogin ? (
              <LoginForm
                authConfig={authConfig}
                turnstileReady={turnstileReady}
                onSuccess={onSuccess}
                onToggleMode={handleToggleMode}
              />
            ) : (
              <SignupWizard
                authConfig={authConfig}
                turnstileReady={turnstileReady}
                onSuccess={onSuccess}
                onToggleMode={handleToggleMode}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
