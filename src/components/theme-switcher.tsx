"use client";

import { useState } from "react";
import { MonitorIcon, MoonIcon, PaletteIcon, SunIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ACCENT_KEY = "view-beads-accent";

const ACCENTS = [
  { value: "neutral", label: "Neutral" },
  { value: "ocean", label: "Ocean" },
  { value: "forest", label: "Forest" },
  { value: "rose", label: "Rose" },
];

function storedAccent(): string {
  if (typeof document === "undefined") return "neutral";
  return localStorage.getItem(ACCENT_KEY) ?? "neutral";
}

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [accent, setAccent] = useState<string>(storedAccent);

  function applyAccent(value: string) {
    setAccent(value);
    if (value === "neutral") {
      delete document.documentElement.dataset.theme;
      localStorage.removeItem(ACCENT_KEY);
    } else {
      document.documentElement.dataset.theme = value;
      localStorage.setItem(ACCENT_KEY, value);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="icon" aria-label="Change theme">
            <PaletteIcon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Mode</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">
            <SunIcon className="size-4" />
            Light
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <MoonIcon className="size-4" />
            Dark
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <MonitorIcon className="size-4" />
            System
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Color</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={accent} onValueChange={applyAccent}>
          {ACCENTS.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
