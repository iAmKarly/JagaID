"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Entity,
  EntityWithRisk,
  Report,
  EntityType,
  ScamType,
  RiskResult,
} from "@/types";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LookupResult {
  found: boolean;
  entity?: Entity;
  risk?: RiskResult;
  reports?: Report[];
  network?: EntityWithRisk[];
}

interface DashboardStats {
  totalReports: number;
  totalEntities: number;
  highRiskCount: number;
  bankCount: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function entityIcon(type: EntityType): string {
  return { bank_account: "🏦", phone: "📱", ewallet: "💳", domain: "🌐" }[type] ?? "📄";
}

function riskStyle(score: number) {
  if (score >= 80)
    return { color: "#ff2d2d", bg: "#ff2d2d18", glow: "0 0 20px #ff2d2d66" };
  if (score >= 50)
    return { color: "#ff9500", bg: "#ff950018", glow: "0 0 20px #ff950066" };
  if (score >= 20)
    return { color: "#ffd60a", bg: "#ffd60a18", glow: "0 0 20px #ffd60a44" };
  return { color: "#30d158", bg: "#30d15818", glow: "0 0 20px #30d15844" };
}

// ── NetworkGraph ──────────────────────────────────────────────────────────────
function NetworkGraph({ network }: { network: EntityWithRisk[] }) {
  if (!network.length) return null;
  return (
    <div data-testid="network-section" style={{ marginTop: 20 }}>
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.15em",
          color: "#ffffff44",
          marginBottom: 12,
        }}
      >
        JARINGAN TERHUBUNG
      </div>
      {network.map((c) => {
        const rs = riskStyle(c.risk.score);
        return (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "10px 14px",
              borderRadius: 8,
              background: "#ffffff08",
              border: "1px solid #ffffff0f",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 18 }}>{entityIcon(c.type)}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: "#fff" }}>{c.value}</div>
              <div style={{ fontSize: 10, color: "#ffffff44", marginTop: 2 }}>
                {c.reports} laporan
              </div>
            </div>
            <div style={{ fontSize: 10, color: rs.color, fontWeight: 700 }}>
              {c.risk.label}
            </div>
          </div>
        );
      })}
      <div
        style={{
          marginTop: 8,
          padding: "8px 12px",
          borderRadius: 6,
          background: "#ff2d2d0a",
          border: "1px solid #ff2d2d22",
        }}
      >
        <span style={{ fontSize: 10, color: "#ff2d2d88" }}>
          ⚠ Entitas ini terhubung ke {network.length} entitas lain — indikasi jaringan
          penipuan
        </span>
      </div>
    </div>
  );
}

// ── Logo ──────────────────────────────────────────────────────────────────────
function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "linear-gradient(135deg,#00ff88,#00c8ff)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 900,
          color: "#0a0f1a",
          boxShadow: "0 0 16px #00ff8866",
        }}
      >
        ⚔
      </div>
      <div>
        <div
          style={{
            fontSize: 15,
            fontWeight: 800,
            letterSpacing: "0.12em",
            color: "#fff",
          }}
        >
          JAGA<span style={{ color: "#00ff88" }}>ID</span>
        </div>
        <div style={{ fontSize: 9, letterSpacing: "0.2em", color: "#ffffff44" }}>
          ANTI FRAUD INDONESIA
        </div>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<"lookup" | "report" | "dashboard">("lookup");

  // Lookup state
  const [query, setQuery] = useState("");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Report state
  const [reportForm, setReportForm] = useState({
    type: "bank_account" as EntityType,
    value: "",
    bank: "",
    scam_type: "Transfer Penipuan" as ScamType,
    amount: "",
    description: "",
  });
  const [reportStatus, setReportStatus] = useState<
    "idle" | "submitting" | "success" | "error"
  >("idle");
  const [reportError, setReportError] = useState("");

  // Dashboard state
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [topEntities, setTopEntities] = useState<EntityWithRisk[]>([]);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState("");

  const s = {
    root: {
      minHeight: "100vh",
      background: "#080d18",
      color: "#fff",
      fontFamily: "var(--font-mono),'Courier New',monospace",
    },
    header: {
      position: "sticky" as const,
      top: 0,
      zIndex: 100,
      background: "#080d18ee",
      backdropFilter: "blur(12px)",
      borderBottom: "1px solid #ffffff0f",
      padding: "14px 20px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    main: { maxWidth: 680, margin: "0 auto", padding: "32px 20px" },
    card: {
      background: "#0d1425",
      border: "1px solid #ffffff0f",
      borderRadius: 16,
      padding: 24,
      marginBottom: 20,
    },
    input: {
      width: "100%",
      padding: "14px 16px",
      borderRadius: 10,
      background: "#ffffff08",
      border: "1px solid #ffffff18",
      color: "#fff",
      fontSize: 13,
      fontFamily: "inherit",
      outline: "none",
      boxSizing: "border-box" as const,
      letterSpacing: "0.05em",
    },
    select: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: 8,
      background: "#ffffff08",
      border: "1px solid #ffffff18",
      color: "#fff",
      fontSize: 12,
      fontFamily: "inherit",
      outline: "none",
      boxSizing: "border-box" as const,
    },
    textarea: {
      width: "100%",
      padding: "12px 14px",
      borderRadius: 8,
      background: "#ffffff08",
      border: "1px solid #ffffff18",
      color: "#fff",
      fontSize: 12,
      fontFamily: "inherit",
      outline: "none",
      boxSizing: "border-box" as const,
      resize: "vertical" as const,
      minHeight: 90,
    },
    label: {
      fontSize: 10,
      letterSpacing: "0.15em",
      color: "#ffffff44",
      display: "block",
      marginBottom: 6,
    },
    btnPrimary: {
      padding: "12px 24px",
      borderRadius: 10,
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: "0.12em",
      background: "linear-gradient(135deg,#00ff88,#00c8ff)",
      color: "#080d18",
      boxShadow: "0 0 20px #00ff8844",
    } as React.CSSProperties,
    btnSecondary: {
      padding: "12px 24px",
      borderRadius: 10,
      border: "none",
      cursor: "pointer",
      fontFamily: "inherit",
      fontWeight: 700,
      fontSize: 11,
      letterSpacing: "0.12em",
      background: "#ffffff0f",
      color: "#ffffff88",
    } as React.CSSProperties,
  };

  // ── API calls ───────────────────────────────────────────────────────────────
  async function handleSearch(overrideQuery?: string) {
    const q = overrideQuery ?? query;
    if (!q.trim()) return;
    if (overrideQuery !== undefined) setQuery(overrideQuery);
    setSearching(true);
    setLookupResult(null);
    setSearchError("");
    try {
      const res = await fetch(`/api/check?q=${encodeURIComponent(q)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Lookup failed");
      setLookupResult(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setSearching(false);
    }
  }

  async function handleReport() {
    if (!reportForm.value.trim() || reportForm.description.trim().length < 10) {
      setReportStatus("error");
      setReportError("Mohon isi nomor dan deskripsi penipuan (min. 10 karakter).");
      return;
    }
    setReportStatus("submitting");
    setReportError("");
    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: reportForm.type,
          value: reportForm.value,
          bank: reportForm.bank || undefined,
          scam_type: reportForm.scam_type,
          amount: reportForm.amount || undefined,
          description: reportForm.description,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Submit failed");
      setReportStatus("success");
      setReportForm({
        type: "bank_account",
        value: "",
        bank: "",
        scam_type: "Transfer Penipuan",
        amount: "",
        description: "",
      });
      setTimeout(() => setReportStatus("idle"), 4000);
    } catch (err) {
      setReportStatus("error");
      setReportError(err instanceof Error ? err.message : "Terjadi kesalahan");
    }
  }

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError("");
    try {
      const res = await fetch("/api/stats");
      const data = await res.json();
      if (res.ok) {
        setStats(data.stats);
        setTopEntities(data.topEntities ?? []);
      } else {
        setStatsError(data.error ?? "Gagal memuat statistik");
      }
    } catch (err) {
      setStatsError(err instanceof Error ? err.message : "Gagal memuat statistik");
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "dashboard") loadStats();
  }, [tab, loadStats]);

  function switchTab(t: "lookup" | "report" | "dashboard") {
    setTab(t);
    setLookupResult(null);
    setSearchError("");
  }

  const TAB_LABELS = { lookup: "CEK", report: "LAPOR", dashboard: "DATA" };

  return (
    <div style={s.root}>
      {/* ── Header ── */}
      <header style={s.header}>
        <Logo />
        <nav style={{ display: "flex", gap: 4 }}>
          {(["lookup", "report", "dashboard"] as const).map((key) => {
            const active = tab === key;
            return (
              <button
                key={key}
                data-testid={`tab-${key}`}
                onClick={() => switchTab(key)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  fontWeight: 700,
                  fontFamily: "inherit",
                  background: active ? "#00ff8818" : "transparent",
                  color: active ? "#00ff88" : "#ffffff44",
                  borderBottom: active ? "2px solid #00ff88" : "2px solid transparent",
                }}
              >
                {TAB_LABELS[key]}
              </button>
            );
          })}
        </nav>
      </header>

      <main style={s.main}>
        {/* ══════════════════════ LOOKUP TAB ══════════════════════ */}
        {tab === "lookup" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  color: "#00ff8888",
                  marginBottom: 12,
                }}
              >
                PERLINDUNGAN NASIONAL
              </div>
              <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>
                Cek Rekening
                <br />
                <span style={{ color: "#00ff88" }}>Penipu</span>
              </h1>
              <p style={{ fontSize: 11, color: "#ffffff44" }}>
                Periksa rekening bank, nomor HP, atau URL sebelum transfer
              </p>
            </div>

            <div style={s.card}>
              <label style={s.label}>NOMOR REKENING / HP / URL</label>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  ref={inputRef}
                  data-testid="search-input"
                  style={s.input}
                  placeholder="cth: 1234567890 atau 08123456789"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
                <button
                  data-testid="search-btn"
                  style={{ ...s.btnPrimary, whiteSpace: "nowrap", minWidth: 80 }}
                  onClick={() => handleSearch()}
                >
                  {searching ? "..." : "CEK →"}
                </button>
              </div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {["1234567890", "08123456789", "investasi-cepat.com"].map((ex) => (
                  <button
                    key={ex}
                    data-testid="example-badge"
                    onClick={() => setQuery(ex)}
                    style={{
                      padding: "4px 10px",
                      borderRadius: 6,
                      border: "1px solid #ffffff18",
                      background: "transparent",
                      color: "#ffffff44",
                      fontSize: 9,
                      fontFamily: "inherit",
                      cursor: "pointer",
                    }}
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>

            {searching && (
              <div style={{ ...s.card, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#00ff8888", letterSpacing: "0.2em" }}>
                  MEMERIKSA DATABASE...
                </div>
              </div>
            )}

            {searchError && (
              <div style={{ ...s.card, border: "1px solid #ff2d2d44" }}>
                <div style={{ fontSize: 11, color: "#ff2d2d" }}>✗ {searchError}</div>
              </div>
            )}

            {lookupResult && !lookupResult.found && (
              <div
                data-testid="result-not-found"
                style={{ ...s.card, border: "1px solid #30d15844" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ fontSize: 32 }}>✅</span>
                  <div>
                    <div style={{ fontWeight: 700, color: "#30d158", fontSize: 14 }}>
                      TIDAK DITEMUKAN
                    </div>
                    <div style={{ fontSize: 11, color: "#ffffff44", marginTop: 4 }}>
                      Tidak ada laporan untuk nomor ini di database kami.
                    </div>
                    <div style={{ fontSize: 10, color: "#ffffff28", marginTop: 6 }}>
                      Tetap waspada — data kami terus diperbarui.
                    </div>
                  </div>
                </div>
                <button
                  data-testid="btn-report-anyway"
                  style={{ ...s.btnSecondary, marginTop: 14 }}
                  onClick={() => {
                    switchTab("report");
                    setReportForm((f) => ({ ...f, value: query }));
                  }}
                >
                  + LAPORKAN JIKA MENCURIGAKAN
                </button>
              </div>
            )}

            {lookupResult?.found &&
              lookupResult.entity &&
              lookupResult.risk &&
              (() => {
                const { entity, risk, reports = [], network = [] } = lookupResult;
                const rs = riskStyle(risk.score);
                return (
                  <div
                    data-testid="result-card"
                    style={{
                      ...s.card,
                      border: `1px solid ${rs.color}44`,
                      boxShadow: rs.glow,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        marginBottom: 20,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#ffffff44",
                            letterSpacing: "0.1em",
                            marginBottom: 6,
                          }}
                        >
                          HASIL PEMERIKSAAN
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ fontSize: 22 }}>{entityIcon(entity.type)}</span>
                          <span style={{ fontSize: 15, fontWeight: 700 }}>
                            {entity.value}
                          </span>
                          {entity.bank && (
                            <span
                              style={{
                                fontSize: 10,
                                color: "#ffffff44",
                                border: "1px solid #ffffff18",
                                padding: "2px 8px",
                                borderRadius: 4,
                              }}
                            >
                              {entity.bank}
                            </span>
                          )}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          data-testid="risk-label"
                          style={{
                            padding: "6px 14px",
                            borderRadius: 8,
                            background: rs.bg,
                            border: `1px solid ${rs.color}44`,
                            fontSize: 11,
                            fontWeight: 700,
                            color: rs.color,
                          }}
                        >
                          {risk.label}
                        </div>
                        <div
                          style={{
                            fontSize: 24,
                            fontWeight: 700,
                            color: rs.color,
                            marginTop: 4,
                          }}
                        >
                          {risk.score}
                          <span style={{ fontSize: 12, color: "#ffffff44" }}>/100</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ marginBottom: 20 }}>
                      <div
                        style={{
                          height: 6,
                          background: "#ffffff0f",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${risk.score}%`,
                            background: `linear-gradient(90deg,#30d158,${rs.color})`,
                            borderRadius: 3,
                          }}
                        />
                      </div>
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr 1fr",
                        gap: 12,
                        marginBottom: 20,
                      }}
                    >
                      <div
                        data-testid="stat-reports"
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: "#ffffff08",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: "#ffffff44",
                            letterSpacing: "0.12em",
                            marginBottom: 4,
                          }}
                        >
                          LAPORAN
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {entity.reports}
                        </div>
                      </div>
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: "#ffffff08",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: "#ffffff44",
                            letterSpacing: "0.12em",
                            marginBottom: 4,
                          }}
                        >
                          TERHUBUNG
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {(entity.connected ?? []).length} entitas
                        </div>
                      </div>
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: "#ffffff08",
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: "#ffffff44",
                            letterSpacing: "0.12em",
                            marginBottom: 4,
                          }}
                        >
                          TERAKHIR
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>
                          {entity.last_seen}
                        </div>
                      </div>
                    </div>

                    {reports.slice(0, 2).map((rep) => (
                      <div
                        key={rep.id}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: "#ffffff06",
                          border: "1px solid #ffffff0a",
                          marginBottom: 8,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            marginBottom: 4,
                          }}
                        >
                          <span
                            style={{ fontSize: 10, color: rs.color, fontWeight: 700 }}
                          >
                            {rep.type}
                          </span>
                          <span style={{ fontSize: 10, color: "#ffffff44" }}>
                            {rep.date}
                          </span>
                        </div>
                        <div
                          style={{ fontSize: 11, color: "#ffffffcc", lineHeight: 1.5 }}
                        >
                          {rep.description}
                        </div>
                        {rep.amount && (
                          <div style={{ fontSize: 10, color: "#ff2d2d88", marginTop: 4 }}>
                            Kerugian: {rep.amount}
                          </div>
                        )}
                      </div>
                    ))}

                    <NetworkGraph network={network} />

                    <div style={{ marginTop: 20, display: "flex", gap: 10 }}>
                      <button
                        style={{ ...s.btnSecondary, flex: 1 }}
                        onClick={() => {
                          const origin =
                            typeof window !== "undefined" && window.location.origin
                              ? window.location.origin
                              : (process.env.NEXT_PUBLIC_APP_URL ?? "");
                          const text = `⚠️ WASPADA PENIPUAN!\n\nNomor: ${entity.value}\nRisiko: ${risk.label} (${risk.score}/100)\nLaporan: ${entity.reports}\n\nCek di: ${origin}`;
                          window.open(
                            `https://wa.me/?text=${encodeURIComponent(text)}`,
                            "_blank",
                            "noopener,noreferrer"
                          );
                        }}
                      >
                        📲 BAGIKAN VIA WA
                      </button>
                      <button
                        style={{ ...s.btnSecondary, flex: 1 }}
                        onClick={() => {
                          switchTab("report");
                          setReportForm((f) => ({ ...f, value: entity.value }));
                        }}
                      >
                        + TAMBAH LAPORAN
                      </button>
                    </div>
                  </div>
                );
              })()}
          </div>
        )}

        {/* ══════════════════════ REPORT TAB ══════════════════════ */}
        {tab === "report" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  color: "#ff9500aa",
                  marginBottom: 8,
                }}
              >
                LAPORKAN PENIPU
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 6px" }}>
                Bantu Lindungi
                <br />
                <span style={{ color: "#00ff88" }}>Sesama</span>
              </h2>
            </div>

            {reportStatus === "success" && (
              <div
                data-testid="report-success"
                style={{
                  ...s.card,
                  border: "1px solid #30d15844",
                  textAlign: "center",
                  marginBottom: 20,
                }}
              >
                <div style={{ fontSize: 24, marginBottom: 8 }}>✅</div>
                <div style={{ color: "#30d158", fontWeight: 700 }}>LAPORAN DITERIMA</div>
                <div style={{ color: "#ffffff44", fontSize: 11, marginTop: 6 }}>
                  Terima kasih telah melindungi komunitas.
                </div>
              </div>
            )}
            {reportStatus === "error" && (
              <div
                data-testid="report-error"
                style={{ ...s.card, border: "1px solid #ff2d2d44", marginBottom: 20 }}
              >
                <span style={{ color: "#ff2d2d", fontSize: 11 }}>⚠ {reportError}</span>
              </div>
            )}

            <div data-testid="report-form" style={s.card}>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>JENIS ENTITAS</label>
                <select
                  data-testid="select-entity-type"
                  style={s.select}
                  value={reportForm.type}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, type: e.target.value as EntityType }))
                  }
                >
                  <option value="bank_account">Rekening Bank</option>
                  <option value="phone">Nomor HP</option>
                  <option value="ewallet">E-Wallet</option>
                  <option value="domain">Website / URL</option>
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>NOMOR / ALAMAT</label>
                <input
                  data-testid="input-entity-value"
                  style={s.input}
                  placeholder={
                    reportForm.type === "bank_account"
                      ? "cth: 1234567890"
                      : reportForm.type === "phone"
                        ? "cth: 08123456789"
                        : "cth: penipuan.com"
                  }
                  value={reportForm.value}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, value: e.target.value }))
                  }
                />
              </div>
              {reportForm.type === "bank_account" && (
                <div style={{ marginBottom: 16 }}>
                  <label style={s.label}>NAMA BANK</label>
                  <select
                    data-testid="select-bank"
                    style={s.select}
                    value={reportForm.bank}
                    onChange={(e) =>
                      setReportForm((f) => ({ ...f, bank: e.target.value }))
                    }
                  >
                    <option value="">— Pilih Bank —</option>
                    {[
                      "BCA",
                      "BRI",
                      "BNI",
                      "Mandiri",
                      "BSI",
                      "CIMB",
                      "Danamon",
                      "Permata",
                      "BTN",
                      "Lainnya",
                    ].map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>MODUS PENIPUAN</label>
                <select
                  data-testid="select-scam-type"
                  style={s.select}
                  value={reportForm.scam_type}
                  onChange={(e) =>
                    setReportForm((f) => ({
                      ...f,
                      scam_type: e.target.value as ScamType,
                    }))
                  }
                >
                  {[
                    "Transfer Penipuan",
                    "Investasi Bodong",
                    "Phishing",
                    "COD Palsu",
                    "Pinjol Ilegal",
                    "Belanja Online",
                    "Lowongan Kerja Palsu",
                    "Lainnya",
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={s.label}>NOMINAL KERUGIAN (OPSIONAL)</label>
                <input
                  data-testid="input-amount"
                  style={s.input}
                  placeholder="cth: Rp 2.500.000"
                  value={reportForm.amount}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, amount: e.target.value }))
                  }
                />
              </div>
              <div style={{ marginBottom: 20 }}>
                <label style={s.label}>KRONOLOGI PENIPUAN</label>
                <textarea
                  data-testid="textarea-description"
                  style={s.textarea}
                  placeholder="Ceritakan bagaimana penipuan terjadi..."
                  value={reportForm.description}
                  onChange={(e) =>
                    setReportForm((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>
              <button
                data-testid="btn-submit-report"
                style={{
                  ...s.btnPrimary,
                  width: "100%",
                  padding: "14px",
                  opacity: reportStatus === "submitting" ? 0.6 : 1,
                }}
                onClick={handleReport}
                disabled={reportStatus === "submitting"}
              >
                {reportStatus === "submitting" ? "MENGIRIM..." : "KIRIM LAPORAN →"}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════════════ DASHBOARD TAB ══════════════════════ */}
        {tab === "dashboard" && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.2em",
                  color: "#00c8ffaa",
                  marginBottom: 8,
                }}
              >
                INTELIJEN REAL-TIME
              </div>
              <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                Database <span style={{ color: "#00ff88" }}>Nasional</span>
              </h2>
            </div>

            {statsLoading && (
              <div style={{ ...s.card, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "#00ff8888", letterSpacing: "0.2em" }}>
                  MEMUAT DATA...
                </div>
              </div>
            )}

            {!statsLoading && statsError && (
              <div
                data-testid="stats-error"
                style={{ ...s.card, textAlign: "center", borderColor: "#ff2d2d44" }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "#ff2d2d",
                    letterSpacing: "0.15em",
                    marginBottom: 6,
                  }}
                >
                  GAGAL MEMUAT
                </div>
                <div style={{ fontSize: 11, color: "#ffffff88" }}>{statsError}</div>
              </div>
            )}

            {!statsLoading && !statsError && stats && (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 20,
                  }}
                >
                  <div
                    data-testid="stat-total-reports"
                    style={{ ...s.card, marginBottom: 0, textAlign: "center" }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>📋</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#00ff88" }}>
                      {stats.totalReports}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#ffffff44",
                        letterSpacing: "0.12em",
                        marginTop: 2,
                      }}
                    >
                      TOTAL LAPORAN
                    </div>
                  </div>
                  <div
                    data-testid="stat-high-risk"
                    style={{ ...s.card, marginBottom: 0, textAlign: "center" }}
                  >
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🚨</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#ff2d2d" }}>
                      {stats.highRiskCount}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#ffffff44",
                        letterSpacing: "0.12em",
                        marginTop: 2,
                      }}
                    >
                      BAHAYA TINGGI
                    </div>
                  </div>
                  <div style={{ ...s.card, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🎯</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#00c8ff" }}>
                      {stats.totalEntities}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#ffffff44",
                        letterSpacing: "0.12em",
                        marginTop: 2,
                      }}
                    >
                      ENTITAS TRACKED
                    </div>
                  </div>
                  <div style={{ ...s.card, marginBottom: 0, textAlign: "center" }}>
                    <div style={{ fontSize: 24, marginBottom: 6 }}>🏦</div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "#ff9500" }}>
                      {stats.bankCount}
                    </div>
                    <div
                      style={{
                        fontSize: 9,
                        color: "#ffffff44",
                        letterSpacing: "0.12em",
                        marginTop: 2,
                      }}
                    >
                      REKENING BANK
                    </div>
                  </div>
                </div>

                {topEntities.length > 0 && (
                  <div style={s.card}>
                    <div
                      style={{
                        fontSize: 11,
                        letterSpacing: "0.15em",
                        color: "#ffffff44",
                        marginBottom: 16,
                      }}
                    >
                      ENTITAS PALING BERBAHAYA
                    </div>
                    {topEntities.map((entity) => {
                      const rs = riskStyle(entity.risk.score);
                      return (
                        <div
                          key={entity.id}
                          data-testid="entity-row"
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            padding: "10px 0",
                            borderBottom: "1px solid #ffffff08",
                            cursor: "pointer",
                          }}
                          onClick={() => {
                            switchTab("lookup");
                            handleSearch(entity.value);
                          }}
                        >
                          <span style={{ fontSize: 20 }}>{entityIcon(entity.type)}</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: "#fff" }}>
                              {entity.value}
                            </div>
                            <div
                              style={{ fontSize: 10, color: "#ffffff44", marginTop: 2 }}
                            >
                              {entity.reports} laporan
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div
                              style={{ fontSize: 14, fontWeight: 700, color: rs.color }}
                            >
                              {entity.risk.score}
                            </div>
                            <div style={{ fontSize: 9, color: rs.color }}>
                              {entity.risk.label}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div data-testid="distribution-section" style={s.card}>
                  <div
                    style={{
                      fontSize: 11,
                      letterSpacing: "0.15em",
                      color: "#ffffff44",
                      marginBottom: 16,
                    }}
                  >
                    BREAKDOWN ENTITAS
                  </div>
                  {[
                    { label: "Rekening Bank", val: stats.bankCount, color: "#ff9500" },
                    {
                      label: "Bahaya Tinggi",
                      val: stats.highRiskCount,
                      color: "#ff2d2d",
                    },
                    {
                      label: "Total Entitas",
                      val: stats.totalEntities,
                      color: "#00c8ff",
                    },
                  ].map((item) => (
                    <div key={item.label} style={{ marginBottom: 12 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <span style={{ fontSize: 11, color: "#ffffff66" }}>
                          {item.label}
                        </span>
                        <span style={{ fontSize: 11, color: item.color }}>
                          {item.val}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 3,
                          background: "#ffffff0f",
                          borderRadius: 2,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${stats.totalEntities > 0 ? Math.round((item.val / stats.totalEntities) * 100) : 0}%`,
                            background: item.color,
                            borderRadius: 2,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div
              data-testid="api-preview"
              style={{ ...s.card, textAlign: "center", border: "1px solid #00ff8812" }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#00ff8888",
                  letterSpacing: "0.1em",
                  marginBottom: 8,
                }}
              >
                API TERSEDIA UNTUK FINTECH
              </div>
              <div style={{ fontSize: 10, color: "#ffffff44", marginBottom: 14 }}>
                Integrasikan data kami ke sistem deteksi fraud Anda
              </div>
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#ffffff08",
                  fontSize: 10,
                  color: "#00ff88",
                  textAlign: "left",
                }}
              >
                GET /api/check?q=1234567890
                <br />
                <span
                  style={{ color: "#ffffff44" }}
                >{`→ { found: true, risk: { score: 92, label: "BAHAYA TINGGI" }, ... }`}</span>
              </div>
            </div>
          </div>
        )}
      </main>

      <style>{`
        input::placeholder, textarea::placeholder { color: #ffffff28; }
        input:focus, textarea:focus, select:focus { border-color: #00ff8844 !important; }
        select option { background: #0d1425; color: #fff; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #080d18; }
        ::-webkit-scrollbar-thumb { background: #ffffff18; border-radius: 2px; }
      `}</style>
    </div>
  );
}
