"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiError, setSession } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [needsTotp, setNeedsTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const campo = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const tenant = await api<{ id: string; name: string }>(`/tenants/${encodeURIComponent(slug.trim())}`, { auth: false });
      const result = await api<{ accessToken: string; user: { userId: string; tenantId: string; fullName: string; roles: string[] } }>(
        "/auth/login",
        {
          method: "POST",
          auth: false,
          body: { tenantId: tenant.id, email: email.trim(), password, ...(totpCode ? { totpCode } : {}) },
        }
      );
      setSession({
        token: result.accessToken,
        tenantId: result.user.tenantId,
        fullName: result.user.fullName,
        roles: result.user.roles,
      });
      router.push("/mapa");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Credenciais inválidas. Se o MFA estiver ativo, informe também o código.");
        setNeedsTotp(true);
      } else if (err instanceof ApiError && err.status === 404) {
        setError("Instituição não encontrada.");
      } else {
        setError("Falha ao conectar à API. Verifique se o servidor está no ar.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-16">
      <h1 className="text-xl font-semibold text-slate-900">Hospital OS</h1>
      <p className="mb-6 text-sm text-slate-500">Acesso ao MVP perioperatório (demonstração).</p>
      <form onSubmit={submit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Instituição (slug)</label>
          <input className={campo} value={slug} onChange={(e) => setSlug(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">E-mail</label>
          <input className={campo} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Senha</label>
          <input className={campo} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="current-password" />
        </div>
        {needsTotp && (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Código MFA (se ativo)</label>
            <input className={campo} inputMode="numeric" value={totpCode} onChange={(e) => setTotpCode(e.target.value)} />
          </div>
        )}
        {error && <p className="text-sm text-rose-700">{error}</p>}
        <button type="submit" disabled={loading} className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
