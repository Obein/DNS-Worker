import React, { useState, useEffect, useRef } from "react";
import {
  Button,
  Card,
  Elevation,
  FormGroup,
  InputGroup,
  H3,
  Intent,
  Callout,
  Tooltip,
  Position,
  Divider
} from "@blueprintjs/core";
import { useTranslation } from "react-i18next";
import {
  ShieldCheck,
  Lock,
  Globe,
  Filter,
  BarChart3,
  Edit3,
  Zap,
  Cpu,
  ArrowLeft,
  Copy
} from "lucide-react";
import { LanguageSwitcher } from "./LanguageSwitcher";
import LogoIcon from "../assets/obex_cat_eye_logo-256.webp";
import { QRCodeCanvas } from "../views/AccountView/components/QRCodeCanvas";

// 扩展 Window 接口以支持 Turnstile
declare global {
  interface Window {
    onloadTurnstileCallback: () => void;
    turnstile: any;
  }
}

interface AuthViewProps {
  onSuccess: () => void;
}

const INTRO_ITEMS = [
  { icon: ShieldCheck, colorClass: "text-blue-500", titleKey: "intro.item1Title", descKey: "intro.item1Desc" },
  { icon: Lock, colorClass: "text-purple-500", titleKey: "intro.item2Title", descKey: "intro.item2Desc" },
  { icon: Globe, colorClass: "text-green-500", titleKey: "intro.item3Title", descKey: "intro.item3Desc" },
  { icon: Filter, colorClass: "text-orange-500", titleKey: "intro.item4Title", descKey: "intro.item4Desc" },
  { icon: BarChart3, colorClass: "text-red-500", titleKey: "intro.item5Title", descKey: "intro.item5Desc" },
  { icon: Zap, colorClass: "text-yellow-500", titleKey: "intro.item6Title", descKey: "intro.item6Desc" },
  { icon: Cpu, colorClass: "text-cyan-500", titleKey: "intro.item7Title", descKey: "intro.item7Desc" },
  { icon: Edit3, colorClass: "text-pink-500", titleKey: "intro.item8Title", descKey: "intro.item8Desc" },
];

const ScrollingIntro = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [isPaused, setIsPaused] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let requestId: number;
    const scrollSpeed = 0.6;
    const scroll = () => {
      if (!isPaused) {
        container.scrollTop += scrollSpeed;
        if (container.scrollTop >= container.scrollHeight / 2) container.scrollTop = 0;
      }
      const rect = container.getBoundingClientRect();
      const hotZone = rect.top + rect.height / 3;
      const bubbles = Array.from(container.children);
      let foundIdx = -1;
      for (let i = 0; i < bubbles.length; i++) {
        const bubbleRect = bubbles[i].getBoundingClientRect();
        if (bubbleRect.top <= hotZone && bubbleRect.bottom >= hotZone) {
          foundIdx = i % INTRO_ITEMS.length;
          break;
        }
      }
      setActiveIdx(foundIdx);
      requestId = requestAnimationFrame(scroll);
    };
    requestId = requestAnimationFrame(scroll);
    return () => cancelAnimationFrame(requestId);
  }, [isPaused]);

  const displayItems = [...INTRO_ITEMS, ...INTRO_ITEMS, ...INTRO_ITEMS, ...INTRO_ITEMS, ...INTRO_ITEMS, ...INTRO_ITEMS];

  return (
    <div
      className="flex flex-col h-full overflow-y-auto no-scrollbar py-[50vh] px-8 lg:px-16 relative select-none cursor-grab active:cursor-grabbing bg-transparent"
      ref={containerRef}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onMouseDown={() => setIsPaused(true)}
      onMouseUp={() => setIsPaused(false)}
      style={{ scrollbarWidth: "none" }}
    >
      {displayItems.map((item, idx) => {
        const isActive = idx % INTRO_ITEMS.length === activeIdx;
        const IconComponent = item.icon;
        const displayIdx = ((idx % INTRO_ITEMS.length) + 1).toString().padStart(2, "0");
        return (
          <div key={idx} className={`transition-all duration-700 ease-in-out shrink-0 border-l-4 mb-8 ${isActive ? "border-blue-600 pl-8 scale-105 opacity-100" : "border-gray-200 dark:border-gray-800 pl-6 opacity-30 grayscale"}`}>
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className={`font-mono text-xs font-bold tracking-widest ${isActive ? "text-blue-600" : "text-gray-400"}`}>/{displayIdx}</span>
                <div className={`transition-transform duration-700 ${isActive ? "rotate-0 scale-110" : "rotate-12 opacity-50"}`}><IconComponent size={24} className={item.colorClass} /></div>
              </div>
              <div className="space-y-2">
                <h2 className={`text-4xl font-black leading-none tracking-tighter uppercase transition-colors duration-500 ${isActive ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-700"}`}>{t(item.titleKey)}</h2>
                <p className={`max-w-md text-lg font-medium leading-snug transition-colors duration-500 ${isActive ? "text-gray-600 dark:text-gray-400" : "text-transparent"}`}>{t(item.descKey)}</p>
              </div>
              {isActive && <div className="flex gap-1 mt-2 transition-all duration-500"><div className="h-1 w-2 bg-gray-200 dark:bg-gray-800" /></div>}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Main Auth View ────────────────────────────────────────────────────────────

export const AuthView: React.FC<AuthViewProps> = ({ onSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loginStep, setLoginStep] = useState<1 | 2>(1);
  
  // Input fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totpToken, setTotpToken] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  
  // Step 2 requirements
  const [requiresPassword, setRequiresPassword] = useState(true);
  const [requiresTotp, setRequiresTotp] = useState(false);
  const [useRecovery, setUseRecovery] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [isPanelVisible, setIsPanelVisible] = useState(true);
  
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Signup TOTP flow state
  const [signupStep, setSignupStep] = useState<'form' | 'totp' | 'recovery'>('form');
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; uri: string } | null>(null);
  const [totpSetupToken, setTotpSetupToken] = useState("");
  const [totpRecoveryKeys, setTotpRecoveryKeys] = useState<string[] | null>(null);
  const [totpSetupLoading, setTotpSetupLoading] = useState(false);
  const [totpSetupError, setTotpSetupError] = useState("");
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  
  const { t } = useTranslation();

  // 动态配置状态
  const [authConfig, setAuthConfig] = useState<{
    turnstile_site_key: string;
    turnstile_enabled_signup: boolean;
    turnstile_enabled_login: boolean;
  } | null>(null);

  // Turnstile 相关
  const [turnstileReady, setTurnstileReady] = useState(!!window.turnstile);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileStatus, setTurnstileStatus] = useState<'idle' | 'verifying' | 'success' | 'error'>('idle');
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/auth/config");
        if (res.ok) setAuthConfig(await res.json());
      } catch (e) { console.error("Failed to load auth config", e); }
    };
    fetchConfig();
  }, []);

  const isTurnstileEnabled = isLogin
    ? authConfig?.turnstile_enabled_login
    : authConfig?.turnstile_enabled_signup;

  useEffect(() => {
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !window.turnstile) {
      window.onloadTurnstileCallback = () => { setTurnstileReady(true); };
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstileCallback";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
  }, [isTurnstileEnabled, authConfig]);

  useEffect(() => {
    // Only render turnstile in Step 1 or Signup
    if ((loginStep === 1 || !isLogin) && isTurnstileEnabled && authConfig?.turnstile_site_key && (turnstileReady || window.turnstile) && turnstileRef.current) {
      try {
        if (widgetIdRef.current && window.turnstile) {
          window.turnstile.remove(widgetIdRef.current);
          widgetIdRef.current = null;
        }
        setTurnstileStatus('verifying');
        turnstileRef.current.innerHTML = "";
        const widgetId = window.turnstile.render(turnstileRef.current, {
          sitekey: authConfig.turnstile_site_key,
          callback: (token: string) => { setTurnstileToken(token); setTurnstileStatus('success'); setError(""); },
          "expired-callback": () => { setTurnstileToken(null); setTurnstileStatus('idle'); },
          "error-callback": (err: any) => {
            console.error("Turnstile error:", err);
            setTurnstileStatus('error');
            setError(t("auth.turnstileError", "Verification service failed to load. Please reload and try again."));
            setTurnstileToken(null);
          },
        });
        widgetIdRef.current = widgetId;
      } catch (e) {
        console.error("Turnstile render error:", e);
        setTurnstileStatus('error');
      }
    }
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [isTurnstileEnabled, authConfig, isLogin, loginStep, turnstileReady, t]);

  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-zA-Z0-9]{5,15}$/.test(username)) { setError(t("auth.formatTipUsername")); return; }
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !turnstileToken) { setError(t("auth.turnstileRequired")); return; }

    setLoading(true);
    setError("");
    
    try {
      const res = await fetch("/api/auth/prelogin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, turnstileToken }),
      });

      if (res.ok) {
        const data = await res.json();
        setRequiresPassword(data.requires_password);
        setRequiresTotp(data.requires_totp);
        setLoginStep(2);
      } else {
        const msg = await res.text();
        setError(msg || t("auth.authFailed"));
        if (window.turnstile) window.turnstile.reset();
        setTurnstileToken(null);
      }
    } catch (err) { setError(t("auth.networkError")); } finally { setLoading(false); }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const body: any = {};
      if (requiresPassword) body.password = password;
      if (requiresTotp) {
        if (useRecovery) body.recoveryKey = recoveryKey;
        else {
          const salt = crypto.randomUUID();
          const msgBuffer = new TextEncoder().encode(totpToken + salt);
          const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
          const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          body.totpTokenHash = hashHex;
          body.totpSalt = salt;
        }
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSuccess();
      } else {
        const msg = await res.text();
        if (msg === "password_leaked" || (res.status === 403 && (msg.toLowerCase().includes("ray id") || msg.includes("blocked") || msg.includes("security service")))) {
          setError(t("auth.passwordLeaked"));
        } else {
          setError(msg || t("auth.authFailed"));
        }
      }
    } catch (err) { setError(t("auth.networkError")); } finally { setLoading(false); }
  };

  const checkUsernameDuplicate = async (uname: string) => {
    if (!uname || !/^[a-zA-Z0-9]{5,15}$/.test(uname)) return;
    try {
      const res = await fetch(`/api/auth/check-username?username=${encodeURIComponent(uname)}`);
      if (res.ok) {
        const data = await res.json() as any;
        if (data.exists) {
          setError(t("auth.usernameExists"));
        } else {
          setError(prev => prev === t("auth.usernameExists") ? "" : prev);
        }
      }
    } catch (e) {
      console.error("Failed to check username duplicate", e);
    }
  };

  const startSignupTotpSetup = async () => {
    setTotpSetupLoading(true);
    setTotpSetupError("");
    try {
      const res = await fetch("/api/account/totp/setup");
      if (res.ok) {
        setTotpSetupData(await res.json());
        setSignupStep('totp');
      } else {
        console.error("Failed to start signup TOTP setup:", await res.text());
        onSuccess();
      }
    } catch (e) {
      console.error("Network error during signup TOTP setup:", e);
      onSuccess();
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const handleSignupTotpConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpSetupData) return;
    setTotpSetupLoading(true);
    setTotpSetupError("");
    try {
      const rawToken = totpSetupToken.replace(/\s/g, "");
      const salt = crypto.randomUUID();
      const msgBuffer = new TextEncoder().encode(rawToken + salt);
      const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
      const hashHex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const res = await fetch("/api/account/totp/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: totpSetupData.secret,
          totpTokenHash: hashHex,
          salt: salt,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setTotpRecoveryKeys(data.recovery_keys);
        setSignupStep('recovery');
      } else {
        setTotpSetupError(await res.text());
      }
    } catch {
      setTotpSetupError(t("common.errorNetwork"));
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const handleCopySignupRecoveryKeys = () => {
    if (!totpRecoveryKeys) return;
    navigator.clipboard.writeText(totpRecoveryKeys.join("\n")).then(() => {
      setCopiedRecovery(true);
      setTimeout(() => setCopiedRecovery(false), 2000);
    });
  };

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[a-zA-Z0-9]{5,15}$/.test(username)) { setError(t("auth.formatTipUsername")); return; }
    if (!/^[a-zA-Z0-9]{12,}$/.test(password)) { setError(t("auth.formatTipPassword")); return; }
    if (isTurnstileEnabled && authConfig?.turnstile_site_key && !turnstileToken) { setError(t("auth.turnstileRequired")); return; }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, turnstileToken }),
      });

      if (res.ok) {
        await startSignupTotpSetup();
      } else {
        const msg = await res.text();
        if (msg === "password_leaked" || (res.status === 403 && (msg.toLowerCase().includes("ray id") || msg.includes("blocked") || msg.includes("security service")))) {
          setError(t("auth.passwordLeaked"));
        } else if (msg === "username_exists") {
          setError(t("auth.usernameExists"));
        } else {
          setError(msg || t("auth.authFailed"));
        }
        if (window.turnstile) window.turnstile.reset();
        setTurnstileToken(null);
      }
    } catch (err) { setError(t("auth.networkError")); } finally { setLoading(false); }
  };

  const resetToStep1 = () => {
    setLoginStep(1);
    setPassword("");
    setTotpToken("");
    setRecoveryKey("");
    setError("");
    setTurnstileToken(null);
    setUseRecovery(false);
  };

  const renderPasswordClearButton = () => {
    if (!password) return undefined;
    return (
      <Button
        minimal={true}
        icon="cross"
        onClick={() => setPassword("")}
      />
    );
  };

  return (
    <div className="flex flex-row min-h-screen bg-white dark:bg-gray-950 overflow-hidden relative">
      <div className="hidden lg:block w-1/2 h-screen overflow-hidden border-r border-gray-100 dark:border-gray-900"><ScrollingIntro /></div>
      <div className={`lg:hidden absolute inset-0 z-0 transition-opacity duration-500 cursor-pointer ${isPanelVisible ? "opacity-25" : "opacity-70"}`} onClick={() => setIsPanelVisible(true)}><ScrollingIntro /></div>
      {!isPanelVisible && (
        <div className="lg:hidden fixed bottom-12 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <Button large intent={Intent.PRIMARY} icon="log-in" text={t("auth.loginBtn")} onClick={() => setIsPanelVisible(true)} className="shadow-2xl px-8 py-4 rounded-full" />
        </div>
      )}
      <div
        className={`flex-1 flex items-center justify-center p-4 relative z-10 bg-gray-50/50 dark:bg-gray-900/30 lg:bg-gray-50 lg:dark:bg-gray-900/50 transition-all duration-500 ease-in-out ${!isPanelVisible ? "max-lg:translate-x-full max-lg:opacity-0 max-lg:pointer-events-none" : "translate-x-0 opacity-100"}`}
        onClick={(e) => { if (window.innerWidth < 1024 && e.target === e.currentTarget) setIsPanelVisible(false); }}
      >
        <div className="absolute top-4 right-4 z-50"><LanguageSwitcher /></div>
        <Card elevation={Elevation.FOUR} className="w-full max-w-md p-8 rounded-2xl shadow-none! z-10 dark:bg-gray-900 border border-gray-100 dark:border-gray-800" onClick={(e) => e.stopPropagation()}>

          <div className="flex flex-col items-center mb-8 relative">
            {loginStep === 2 && isLogin && (
              <button 
                onClick={resetToStep1} 
                className="absolute left-0 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 bg-transparent border-none cursor-pointer"
                title="Back to username"
              >
                <ArrowLeft size={24} />
              </button>
            )}
            <img src={LogoIcon} alt="Obex DNS Logo" className="w-20 h-20 object-contain" />
            <H3 className="font-bold tracking-tight text-2xl mt-4">
              {isLogin 
                ? (loginStep === 2 ? t("auth.authRequired", "Authentication Required") : t("auth.login")) 
                : (signupStep === 'form' 
                    ? t("auth.signup") 
                    : (signupStep === 'totp' 
                        ? t("account.totp.title", "Two-Factor Authentication (2FA)") 
                        : t("account.totp.recoveryKeysTitle", "Save Recovery Keys")
                      )
                  )
              }
            </H3>
            <p className="text-gray-500 mt-2 text-center text-sm leading-relaxed">
              {isLogin 
                ? (loginStep === 2 ? username : t("auth.welcomeBack")) 
                : (signupStep === 'form' 
                    ? t("auth.protectInternet") 
                    : (signupStep === 'totp' 
                        ? t("account.totp.setupDesc", "Add an extra layer of security.") 
                        : t("account.totp.recoveryKeysWarning", "Store keys safely.")
                      )
                  )
              }
            </p>
          </div>

          {error && <Callout intent={Intent.DANGER} className="mb-6 rounded-xl" title={t("auth.error")}>{error}</Callout>}

          {/* Login Step 1 OR Signup */}
          {(loginStep === 1 || (!isLogin && signupStep === 'form')) && (
            <form onSubmit={isLogin ? handleStep1Submit : handleSignupSubmit} className="space-y-4">
              <FormGroup label={t("auth.username")} labelFor="username">
                <Tooltip
                  content={t("auth.formatTipUsername")}
                  isOpen={usernameFocused && !isLogin}
                  disabled={isLogin}
                  position={Position.TOP}
                  intent={Intent.PRIMARY}
                  className="w-full"
                >
                  <div className="w-full block">
                    <InputGroup
                      id="username"
                      leftIcon="user"
                      placeholder={t("auth.usernamePlaceholder")}
                      size="large"
                      className="rounded-xl w-full"
                      value={username}
                      onChange={(e) => {
                        setUsername(e.target.value);
                        setError(prev => prev === t("auth.usernameExists") ? "" : prev);
                      }}
                      onFocus={() => setUsernameFocused(true)}
                      onBlur={() => {
                        setUsernameFocused(false);
                        if (!isLogin) {
                          checkUsernameDuplicate(username);
                        }
                      }}
                      required
                    />
                  </div>
                </Tooltip>
              </FormGroup>

              {!isLogin && (
                <FormGroup label={t("auth.password")} labelFor="password">
                  <Tooltip
                    content={t("auth.formatTipPassword")}
                    isOpen={passwordFocused}
                    position={Position.TOP}
                    intent={Intent.PRIMARY}
                    className="w-full"
                  >
                    <div className="w-full block">
                      <InputGroup
                        id="password"
                        leftIcon="lock"
                        placeholder={t("auth.passwordPlaceholder")}
                        type="password"
                        size="large"
                        className="rounded-xl w-full"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onFocus={() => setPasswordFocused(true)}
                        onBlur={() => setPasswordFocused(false)}
                        rightElement={renderPasswordClearButton()}
                        required
                      />
                    </div>
                  </Tooltip>
                </FormGroup>
              )}

              {isTurnstileEnabled && authConfig?.turnstile_site_key && (
                <div className="py-2 flex justify-center min-h-16.25"><div ref={turnstileRef} /></div>
              )}

              <Button fill size="large" intent={Intent.PRIMARY} type="submit" loading={loading || turnstileStatus === 'verifying'} disabled={isTurnstileEnabled && !!authConfig?.turnstile_site_key && turnstileStatus !== 'success'} className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20">
                {turnstileStatus === 'verifying' ? t("auth.verifying") : (isLogin ? t("auth.next", "Next") : t("auth.signupBtn"))}
              </Button>
            </form>
          )}

          {/* Signup Step 2: TOTP Setup */}
          {!isLogin && signupStep === 'totp' && totpSetupData && (
            <div className="space-y-4">
              <div className="flex flex-col items-center gap-3">
                <QRCodeCanvas uri={totpSetupData.uri} />
                <div className="text-center">
                  <p className="text-xs text-gray-500 mb-1">
                    {t("account.totp.orEnterManually", "Or enter the key manually:")}
                  </p>
                  <code className="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded select-all">
                    {totpSetupData.secret}
                  </code>
                </div>
              </div>
              <Divider />
              {totpSetupError && <Callout intent={Intent.DANGER}>{totpSetupError}</Callout>}
              <form onSubmit={handleSignupTotpConfirm} className="space-y-3">
                <FormGroup
                  label={t("account.totp.enterCode", "Enter the 6-digit code to confirm:")}
                  helperText={t(
                    "account.totp.enterCodeHint",
                    "This verifies the key was scanned correctly."
                  )}
                >
                  <InputGroup
                    id="totp-signup-setup-token"
                    placeholder="000000"
                    value={totpSetupToken}
                    onChange={(e) =>
                      setTotpSetupToken(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    maxLength={6}
                    inputMode="numeric"
                    className="font-mono tracking-widest text-center"
                    required
                  />
                </FormGroup>
                <div className="flex gap-2 pt-2">
                  <Button
                    fill
                    text={t("auth.skip", "Skip")}
                    onClick={() => onSuccess()}
                  />
                  <Button
                    fill
                    intent={Intent.SUCCESS}
                    type="submit"
                    loading={totpSetupLoading}
                    text={t("account.totp.activate", "Activate")}
                    disabled={totpSetupToken.length < 6}
                  />
                </div>
              </form>
            </div>
          )}

          {/* Signup Step 3: TOTP Recovery Keys */}
          {!isLogin && signupStep === 'recovery' && totpRecoveryKeys && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 mb-4">
                {totpRecoveryKeys.map((key, i) => (
                  <code
                    key={i}
                    className="font-mono text-sm bg-gray-100 dark:bg-gray-800 px-3 py-1.5 rounded text-center tracking-wider"
                  >
                    {key}
                  </code>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  fill
                  icon={<Copy size={14} />}
                  text={
                    copiedRecovery
                      ? t("account.totp.copied", "Copied!")
                      : t("account.totp.copyKeys", "Copy All Keys")
                  }
                  intent={copiedRecovery ? Intent.SUCCESS : Intent.NONE}
                  onClick={handleCopySignupRecoveryKeys}
                />
                <Button
                  fill
                  intent={Intent.PRIMARY}
                  text={t("account.totp.done", "Done")}
                  onClick={() => onSuccess()}
                />
              </div>
            </div>
          )}

          {/* Login Step 2 */}
          {loginStep === 2 && isLogin && (
            <form onSubmit={handleStep2Submit} className="space-y-4">
              {requiresPassword && (
                <FormGroup label={t("auth.password")} labelFor="password">
                  <InputGroup
                    id="password"
                    leftIcon="lock"
                    placeholder={t("auth.passwordPlaceholder")}
                    type="password"
                    size="large"
                    className="rounded-xl"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    rightElement={renderPasswordClearButton()}
                    autoFocus
                    required
                  />
                </FormGroup>
              )}

              {requiresTotp && (
                <>
                  {useRecovery ? (
                    <FormGroup label={t("account.totp.recoveryKeysTitle", "Recovery Key")}>
                      <InputGroup
                        id="recovery-key"
                        leftIcon="key"
                        placeholder="XXXXXXXXXX"
                        size="large"
                        className="rounded-xl font-mono tracking-widest"
                        value={recoveryKey}
                        onChange={(e) => setRecoveryKey(e.target.value)}
                        required
                        autoFocus={!requiresPassword}
                      />
                    </FormGroup>
                  ) : (
                    <FormGroup label={requiresPassword ? t("account.totp.title", "Two-Factor Verification (TOTP)") : t("auth.totpVerification", "TOTP Verification")}>
                      <InputGroup
                        id="totp-code"
                        leftIcon="shield"
                        placeholder="000000"
                        size="large"
                        className="rounded-xl font-mono tracking-widest text-center"
                        value={totpToken}
                        onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                        maxLength={6}
                        inputMode="numeric"
                        required
                        autoFocus={!requiresPassword}
                      />
                    </FormGroup>
                  )}

                  <div className="text-right mt-1">
                    <button
                      type="button"
                      onClick={() => { setUseRecovery(!useRecovery); setError(""); }}
                      className="text-blue-600 dark:text-blue-400 text-xs hover:underline bg-transparent border-none cursor-pointer p-0"
                    >
                      {useRecovery ? t("auth.totpUseApp", "Use Authenticator App") : t("auth.totpUseRecovery", "Use Recovery Key")}
                    </button>
                  </div>
                </>
              )}

              <Button fill size="large" intent={Intent.PRIMARY} type="submit" loading={loading} className="mt-6 font-bold py-6 rounded-xl shadow-lg shadow-blue-500/20">
                {t("auth.loginBtn")}
              </Button>
            </form>
          )}

          {loginStep === 1 && (isLogin || signupStep === 'form') && (
            <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
              <button onClick={() => { setIsLogin(!isLogin); setError(""); setTurnstileToken(null); }} className="text-blue-600 dark:text-blue-400 font-semibold hover:underline bg-transparent border-none cursor-pointer text-sm">
                {isLogin ? t("auth.noAccount") : t("auth.haveAccount")}
              </button>
            </div>
          )}

        </Card>
      </div>
    </div>
  );
};
