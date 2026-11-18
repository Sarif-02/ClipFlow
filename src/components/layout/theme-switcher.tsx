"use client";

import { DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const modes = [
  { key: "light", label: "Light", Icon: SunIcon },
  { key: "dark", label: "Dark", Icon: MoonIcon },
  { key: "system", label: "System", Icon: DesktopIcon },
] as const;

const subscribe = () => () => {};
const mounted = () => true;
const server = () => false;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(subscribe, mounted, server);

  return (
    <div className="theme-switcher" role="group" aria-label="Appearance">
      {modes.map(({ key, label, Icon }) => (
        <button type="button" key={key} title={label} aria-label={`${label} theme`}
          aria-pressed={(hydrated ? theme : "system") === key} onClick={() => setTheme(key)}>
          <Icon size={16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
