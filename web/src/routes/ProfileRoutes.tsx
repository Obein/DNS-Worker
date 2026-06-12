import { Suspense } from "react";
import { Routes, Route, useParams } from "react-router-dom";
import { Spinner } from "@blueprintjs/core";
import { lazyWithPreload } from "../utils/lazyWithPreload";
import { NotFoundView } from "../views/NotFoundView";

const SetupView = lazyWithPreload(() =>
  import("../views/SetupView").then((m) => ({ default: m.SetupView })),
);
const FilteringView = lazyWithPreload(() =>
  import("../views/FilteringView").then((m) => ({ default: m.FilteringView })),
);
const RulesView = lazyWithPreload(() =>
  import("../views/RulesView").then((m) => ({ default: m.RulesView })),
);
const SettingsView = lazyWithPreload(() =>
  import("../views/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const AnalyticsView = lazyWithPreload(() =>
  import("../views/AnalyticsView").then((m) => ({ default: m.AnalyticsView })),
);
const LogsView = lazyWithPreload(() =>
  import("../views/LogsView").then((m) => ({ default: m.LogsView })),
);

export const preloadMainViews = () => {
  SetupView.preload();
  LogsView.preload();
};

export const preloadHeavyViews = () => {
  AnalyticsView.preload();
  SettingsView.preload();
  RulesView.preload();
  FilteringView.preload();
};

interface ProfileRoutesProps {
  selectedProfile: any;
  prefilledRule: any;
  setPrefilledRule: any;
  handleQuickAction: any;
  toasterRef: any;
}

export const ProfileRoutes = ({
  selectedProfile,
  prefilledRule,
  setPrefilledRule,
  handleQuickAction,
  toasterRef,
}: ProfileRoutesProps) => {
  const { profileId } = useParams();
  const id = profileId || selectedProfile?.id || "";
  return (
    <Suspense
      fallback={
        <div className="p-20 flex justify-center">
          <Spinner size={40} />
        </div>
      }
    >
      <Routes>
        <Route
          path="setup"
          element={
            <SetupView
              profileId={id}
              profileKey={selectedProfile?.profile_key || id}
              toasterRef={toasterRef}
            />
          }
        />
        <Route
          path="filter"
          element={<FilteringView profileId={id} toasterRef={toasterRef} />}
        />
        <Route
          path="rules"
          element={
            <RulesView
              profileId={id}
              prefill={prefilledRule}
              onPrefillUsed={() => setPrefilledRule(null)}
              toasterRef={toasterRef}
            />
          }
        />
        <Route
          path="settings"
          element={<SettingsView profileId={id} toasterRef={toasterRef} />}
        />
        <Route path="stats" element={<AnalyticsView profileId={id} />} />
        <Route
          path="logs"
          element={
            <LogsView profileId={id} onQuickAction={handleQuickAction} />
          }
        />
        <Route path="*" element={<NotFoundView />} />
      </Routes>
    </Suspense>
  );
};
