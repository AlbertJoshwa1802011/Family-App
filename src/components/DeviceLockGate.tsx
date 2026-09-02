import { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, Lock, ShieldCheck } from "lucide-react";
import { Outlet } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Page } from "./ui/Page";
import { AppBar } from "./ui/AppBar";

type Status = {
  webauthn: boolean;
  pin: boolean;
  rpId: string;
};

function bufferToB64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBuffer(s: string): ArrayBuffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "==".slice((s.length * 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function webauthnAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";
}

async function registerWebauthn(): Promise<void> {
  const opts = await api<{
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    timeout: number;
    pubKeyCredParams: { type: "public-key"; alg: number }[];
    authenticatorSelection: PublicKeyCredentialCreationOptions["authenticatorSelection"];
  }>("/device-lock/webauthn/options?purpose=register");

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: b64urlToBuffer(opts.challenge),
      rp: opts.rp,
      user: {
        id: new TextEncoder().encode(opts.user.id),
        name: opts.user.name,
        displayName: opts.user.displayName,
      },
      pubKeyCredParams: opts.pubKeyCredParams,
      timeout: opts.timeout,
      authenticatorSelection: opts.authenticatorSelection,
      attestation: "none",
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Registration was cancelled.");
  const att = cred.response as AuthenticatorAttestationResponse;
  const authData =
    typeof att.getAuthenticatorData === "function"
      ? att.getAuthenticatorData()
      : null;
  await api("/device-lock/webauthn/register", {
    method: "POST",
    body: JSON.stringify({
      id: cred.id,
      rawId: bufferToB64url(cred.rawId),
      clientDataJSON: bufferToB64url(att.clientDataJSON),
      ...(authData ? { authenticatorData: bufferToB64url(authData) } : {}),
      attestationObject: bufferToB64url(att.attestationObject),
    }),
  });
}

async function assertWebauthn(allowIds: string[]): Promise<void> {
  const opts = await api<{
    challenge: string;
    rp: { id: string };
    timeout: number;
    allowCredentials: { type: string; id: string }[];
  }>("/device-lock/webauthn/options?purpose=assert");

  const allow =
    opts.allowCredentials.length > 0
      ? opts.allowCredentials
      : allowIds.map((id) => ({ type: "public-key" as const, id }));

  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBuffer(opts.challenge),
      rpId: opts.rp.id,
      timeout: opts.timeout,
      userVerification: "required",
      allowCredentials: allow.map((c) => ({
        type: "public-key" as const,
        id: b64urlToBuffer(c.id),
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Unlock was cancelled.");
  const assertion = cred.response as AuthenticatorAssertionResponse;
  await api("/device-lock/webauthn/assert", {
    method: "POST",
    body: JSON.stringify({
      id: cred.id,
      clientDataJSON: bufferToB64url(assertion.clientDataJSON),
      authenticatorData: bufferToB64url(assertion.authenticatorData),
      signature: bufferToB64url(assertion.signature),
    }),
  });
}

export function DeviceLockGate({
  section,
  title,
}: {
  section: "money" | "vault";
  title: string;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    void api<Status>("/device-lock/status")
      .then(setStatus)
      .catch(() => setStatus({ webauthn: false, pin: false, rpId: "" }));
  }, []);

  const markUnlocked = useCallback(() => {
    setUnlocked(true);
  }, []);

  useEffect(() => {
    if (!status?.webauthn || unlocked || autoTried.current || !webauthnAvailable()) {
      return;
    }
    autoTried.current = true;
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await assertWebauthn([]);
        markUnlocked();
      } catch (e) {
        setError(
          e instanceof ApiError || e instanceof Error
            ? e.message
            : "Face ID / fingerprint failed.",
        );
      } finally {
        setBusy(false);
      }
    })();
  }, [status, unlocked, markUnlocked]);

  async function onFaceId() {
    setError(null);
    setBusy(true);
    try {
      if (!status?.webauthn) {
        await registerWebauthn();
      } else {
        await assertWebauthn([]);
      }
      markUnlocked();
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error
          ? e.message
          : "Face ID / fingerprint failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onPin(setup: boolean) {
    setError(null);
    if (!/^\d{6}$/.test(pin)) {
      setError("Enter a 6-digit PIN.");
      return;
    }
    setBusy(true);
    try {
      await api(setup ? "/device-lock/pin/setup" : "/device-lock/pin/verify", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      markUnlocked();
    } catch (e) {
      setError(
        e instanceof ApiError || e instanceof Error ? e.message : "PIN failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (unlocked) return <Outlet />;

  const needsSetup = status && !status.webauthn && !status.pin;
  const canWebauthn = webauthnAvailable();

  return (
    <>
      <AppBar title={title} back />
      <Page className="space-y-4" aria-label={`${section} lock`}>
        <Card className="space-y-4 p-5">
          <div className="flex items-center gap-3">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-vault-500/15 text-vault-300">
              <Lock className="size-6" />
            </span>
            <div>
              <h1 className="text-base font-semibold text-fg">Unlock {title}</h1>
              <p className="text-sm text-fg-muted">
                Face ID, fingerprint, or your device PIN — every time you open
                this section.
              </p>
            </div>
          </div>

          {needsSetup && (
            <p className="text-sm text-fg-muted">
              First visit: register this phone so only you can open Money and
              the Vault.
            </p>
          )}

          {canWebauthn && (
            <Button fullWidth loading={busy} onClick={() => void onFaceId()} leadingIcon={<Fingerprint className="size-4" />}>
              {status?.webauthn
                ? "Unlock with Face ID / fingerprint"
                : "Set up Face ID / fingerprint"}
            </Button>
          )}

          <div className="space-y-2">
            <label htmlFor="device-pin" className="text-xs font-medium text-fg-subtle">
              6-digit PIN {status?.pin ? "(fallback)" : "(set one as backup)"}
            </label>
            <input
              id="device-pin"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-xl border border-line bg-ink-950 px-3.5 py-3 text-center text-lg tracking-[0.4em] text-fg"
            />
            <Button
              fullWidth
              variant="secondary"
              loading={busy}
              onClick={() => void onPin(!(status?.pin))}
              leadingIcon={<ShieldCheck className="size-4" />}
            >
              {status?.pin ? "Unlock with PIN" : "Save PIN and unlock"}
            </Button>
          </div>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </Card>
      </Page>
    </>
  );
}

export function DeviceLockOutlet() {
  return <Outlet />;
}