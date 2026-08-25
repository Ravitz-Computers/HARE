import { useEffect, useState } from "react";
import { Sidebar, type Page } from "./components/Sidebar";
import { Onboarding } from "./pages/Onboarding";
import { Dashboard } from "./pages/Dashboard";
import { DeviceDetail } from "./pages/DeviceDetail";
import { EffectsPage } from "./pages/Effects";
import { GalleryPage } from "./pages/Gallery";
import { WidgetEngine } from "./pages/WidgetEngine";
import { SettingsPage } from "./pages/Settings";
import { VinnyFlourish } from "./components/VinnyFlourish";
import { useHareStore } from "@/state/store";

export default function App() {
  const { ready, hasSeenOnboarding, state, appSettings, effectFlourish, init, completeOnboarding } =
    useHareStore();
  const [page, setPage] = useState<Page>("dashboard");
  const [openDeviceId, setOpenDeviceId] = useState<number | null>(null);

  useEffect(() => {
    void init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!ready) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-hare-bg">
        <div className="h-8 w-8 rounded-full border-2 border-glow-pink border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!hasSeenOnboarding) {
    return (
      <Onboarding
        state={state}
        onDone={completeOnboarding}
        askForAccess={!appSettings.hasAskedForHardwareAccess}
      />
    );
  }

  const handleNavigate = (p: Page) => {
    setOpenDeviceId(null);
    setPage(p);
  };

  return (
    <div className="h-screen w-screen flex bg-hare-bg overflow-hidden">
      <Sidebar page={page} onNavigate={handleNavigate} state={state} />
      <main className="flex-1 overflow-y-auto">
        {page === "dashboard" &&
          (openDeviceId !== null ? (
            <DeviceDetail deviceId={openDeviceId} onBack={() => setOpenDeviceId(null)} />
          ) : (
            <Dashboard onOpenDevice={setOpenDeviceId} />
          ))}
        {page === "effects" && <EffectsPage />}
        {page === "gallery" && <GalleryPage />}
        {page === "widgets" && <WidgetEngine />}
        {page === "settings" && <SettingsPage />}
      </main>
      <VinnyFlourish trigger={effectFlourish} />
    </div>
  );
}
