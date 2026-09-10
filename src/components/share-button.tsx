"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  CopyIcon,
  RotateCwIcon,
  Share2Icon,
  XIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { TunnelMode, TunnelSettings } from "@/lib/config";

interface ShareStatus {
  url: string | null;
  settings: {
    mode: TunnelMode;
    name: string;
    url: string;
    hasToken: boolean;
  };
  source: "env" | "file" | "default";
}

type ShareState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "sharing"; url: string }
  | { status: "error"; message: string };

const MODE_OPTIONS: { value: TunnelMode; label: string }[] = [
  { value: "quick", label: "Quick tunnel (no setup)" },
  { value: "named", label: "Named tunnel" },
  { value: "token", label: "Token tunnel" },
];

// Where a remotely-managed tunnel should send traffic: this dashboard's own
// port. Only called while the panel is open, so window is always defined.
function localServerUrl(): string {
  return `http://localhost:${window.location.port || "80"}`;
}

export function ShareButton() {
  const [share, setShare] = useState<ShareState>({ status: "idle" });
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mode, setMode] = useState<TunnelMode>("quick");
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [url, setUrl] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [envManaged, setEnvManaged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);

  // Restore the tunnel state after a reload so the panel reflects a tunnel
  // that is still running server-side.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/share")
      .then((res) => res.json())
      .then((data: ShareStatus) => {
        if (cancelled) return;
        setMode(data.settings.mode);
        setName(data.settings.name);
        setUrl(data.settings.url);
        setHasToken(data.settings.hasToken);
        setEnvManaged(data.source === "env");
        if (data.url) setShare({ status: "sharing", url: data.url });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    if (share.status === "sharing") {
      urlInputRef.current?.focus();
      urlInputRef.current?.select();
    } else {
      startButtonRef.current?.focus();
    }
  }, [open, share.status]);

  useEffect(() => {
    // While the tunnel dropdown is open, Escape belongs to it, not the panel.
    if (!open || modeMenuOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, modeMenuOpen]);

  function closePanel() {
    setOpen(false);
    setCopied(false);
    triggerRef.current?.focus();
  }

  function draft(): TunnelSettings {
    return { mode, name, token, url };
  }

  function draftValid(): boolean {
    if (envManaged) return true;
    if (mode === "named") return name.trim() !== "" && url.trim() !== "";
    if (mode === "token") return token.trim() !== "" && url.trim() !== "";
    return true;
  }

  async function startSharing() {
    setSaving(true);
    setShare({ status: "starting" });
    try {
      let envTookOver = false;
      let res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: draft() }),
      });
      if (res.status === 409) {
        // Env vars took over (or were set meanwhile): start with those.
        envTookOver = true;
        setEnvManaged(true);
        res = await fetch("/api/share", { method: "POST" });
      }
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error ?? `Couldn't share (HTTP ${res.status})`);
      }
      if (!envTookOver) {
        setToken("");
        setHasToken(mode === "token");
      }
      setShare({ status: "sharing", url: data.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setShare({ status: "error", message });
    } finally {
      setSaving(false);
    }
  }

  async function stopSharing() {
    try {
      await fetch("/api/share", { method: "DELETE" });
    } catch {
      // The tunnel may still be shutting down; treat it as stopped locally.
    }
    setShare({ status: "idle" });
    setCopied(false);
  }

  function togglePanel() {
    if (open) {
      closePanel();
    } else {
      setOpen(true);
    }
  }

  async function copyUrl() {
    if (share.status !== "sharing") return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  const sharing = share.status === "sharing";
  const busy = share.status === "starting";

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              ref={triggerRef}
              variant="outline"
              size="icon"
              aria-label="Share board"
              aria-pressed={sharing}
              aria-expanded={open}
              onClick={togglePanel}
            >
              {busy ? (
                <RotateCwIcon className="size-4 animate-spin" />
              ) : (
                <Share2Icon className="size-4" />
              )}
            </Button>
          }
        />
        <TooltipContent>{sharing ? "Sharing" : "Share board"}</TooltipContent>
      </Tooltip>
      {open && (
        <div
          role="dialog"
          aria-label="Share board"
          className="absolute top-full right-0 z-50 mt-1.5 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-3 text-popover-foreground shadow-md"
        >
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Share board</h2>
            <Button variant="ghost" size="icon-xs" aria-label="Close" onClick={closePanel}>
              <XIcon />
            </Button>
          </div>
          {share.status === "starting" && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <RotateCwIcon className="size-4 animate-spin" />
              Starting tunnel...
            </p>
          )}
          {share.status === "error" && (
            <>
              <p role="alert" className="mb-2 break-words text-sm text-destructive">
                {share.message}
              </p>
              <Button ref={startButtonRef} size="sm" className="w-full" onClick={startSharing}>
                Try again
              </Button>
            </>
          )}
          {sharing && (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Anyone with this link can view the dashboard while it stays open. It stops
                working when sharing is stopped or the server shuts down.
              </p>
              <div className="mb-2 flex gap-1.5">
                <Input
                  ref={urlInputRef}
                  readOnly
                  value={share.url}
                  aria-label="Public link"
                  className="font-mono text-xs"
                />
                <Button variant="outline" size="icon" onClick={copyUrl} aria-label={copied ? "Copied" : "Copy link"}>
                  {copied ? <CheckIcon className="size-4 text-green-600" /> : <CopyIcon className="size-4" />}
                </Button>
              </div>
              <Button variant="destructive" size="sm" className="w-full" onClick={stopSharing}>
                Stop sharing
              </Button>
            </>
          )}
          {share.status === "idle" && (
            <div className="flex flex-col gap-3">
              {envManaged && (
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  Tunnel settings are set by environment variables — edit those to change them.
                </p>
              )}
              <div>
                <span id="share-mode-label" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Tunnel
                </span>
                <Select
                  value={mode}
                  disabled={envManaged}
                  onValueChange={(value) => setMode(value as TunnelMode)}
                  onOpenChange={setModeMenuOpen}
                >
                  <SelectTrigger className="w-full" aria-labelledby="share-mode-label">
                    <SelectValue>{MODE_OPTIONS.find((option) => option.value === mode)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MODE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mode === "quick" && (
                <p className="text-xs text-muted-foreground">
                  A temporary trycloudflare.com link that changes every time. Fine for a quick
                  look, but it can be slow. For a stable link on your own domain, pick a named or
                  token tunnel.
                </p>
              )}
              {mode === "named" && !envManaged && (
                <div className="text-xs text-muted-foreground">
                  <p>
                    A stable link on your own domain, using a tunnel you create once from the
                    command line.
                  </p>
                  <details className="mt-1.5">
                    <summary className="w-fit cursor-pointer rounded font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                      Setup steps
                    </summary>
                    <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
                      <li>
                        Add your domain to a Cloudflare account and install{" "}
                        <code className="font-mono">cloudflared</code>.
                      </li>
                      <li>
                        Run these once:
                        <pre className="mt-1 whitespace-pre-wrap rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-foreground">
                          {"cloudflared tunnel login\n" +
                            "cloudflared tunnel create view-beads\n" +
                            "cloudflared tunnel route dns view-beads board.example.com"}
                        </pre>
                      </li>
                      <li>
                        Enter <code className="font-mono">view-beads</code> and{" "}
                        <code className="font-mono">https://board.example.com</code> below
                        (with your own names).
                      </li>
                    </ol>
                  </details>
                </div>
              )}
              {mode === "token" && !envManaged && (
                <div className="text-xs text-muted-foreground">
                  <p>
                    A stable link on your own domain, set up in the Cloudflare dashboard instead
                    of the command line.
                  </p>
                  <details className="mt-1.5">
                    <summary className="w-fit cursor-pointer rounded font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                      Setup steps
                    </summary>
                    <ol className="mt-1.5 list-decimal space-y-1.5 pl-4">
                      <li>
                        In{" "}
                        <a
                          href="https://one.dash.cloudflare.com/"
                          target="_blank"
                          rel="noreferrer"
                          className="rounded text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          Cloudflare Zero Trust<span className="sr-only"> (opens in a new tab)</span>
                        </a>
                        , go to Networks → Tunnels and create a tunnel.
                      </li>
                      <li>Copy its token (the long string in the install command).</li>
                      <li>
                        Add a public hostname that points to{" "}
                        <code className="whitespace-nowrap font-mono">{localServerUrl()}</code>.
                      </li>
                      <li>Paste the token and that hostname below.</li>
                    </ol>
                  </details>
                </div>
              )}
              {mode === "named" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="share-name">
                    Tunnel name
                  </label>
                  <Input
                    id="share-name"
                    value={name}
                    disabled={envManaged}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="view-beads"
                    className="text-sm"
                  />
                </div>
              )}
              {mode === "token" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="share-token">
                    Token
                  </label>
                  <Input
                    id="share-token"
                    type="password"
                    value={token}
                    disabled={envManaged}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={hasToken ? "Saved token (enter a new one to replace)" : "Tunnel token"}
                    className="text-sm"
                  />
                </div>
              )}
              {mode !== "quick" && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="share-url">
                    Public URL
                  </label>
                  <Input
                    id="share-url"
                    value={url}
                    disabled={envManaged}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://board.example.com"
                    className="text-sm"
                  />
                </div>
              )}
              <Button
                ref={startButtonRef}
                size="sm"
                className="w-full"
                disabled={saving || !draftValid()}
                onClick={startSharing}
              >
                Start sharing
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
