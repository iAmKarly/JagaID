"use client";

import { useState, useRef, useCallback } from "react";

type UploadStatus = "idle" | "uploading" | "success" | "error";
type ResetStatus = "idle" | "confirming" | "resetting" | "done" | "error";

interface UploadResult {
  total_rows: number;
  entities_processed: number;
  reports_added: number;
  skipped: number;
  errors?: string[];
}

const CSV_TEMPLATE = `type,value,bank,scam_type
domain,investasi-bodong.com,,Investasi Bodong
bank_account,1234567890,BRI,Transfer Penipuan
phone,08123456789,,Phishing
bank_account,9876543210,BCA,Investasi Bodong
domain,pinjol-cepat.id,,Pinjol Ilegal`;

const s = {
  root: {
    minHeight: "100vh",
    background: "#080d18",
    color: "#fff",
    fontFamily: "var(--font-mono),'Courier New',monospace",
    padding: "40px 20px",
  },
  wrap: { maxWidth: 720, margin: "0 auto" },
  card: {
    background: "#0d1425",
    border: "1px solid #ffffff0f",
    borderRadius: 16,
    padding: 28,
    marginBottom: 20,
  },
  label: {
    fontSize: 10,
    letterSpacing: "0.15em",
    color: "#ffffff44",
    display: "block",
    marginBottom: 8,
  },
  input: {
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
  btnPrimary: {
    padding: "12px 28px",
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
  btnDanger: {
    padding: "12px 28px",
    borderRadius: 10,
    border: "1px solid #ff2d2d44",
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 700,
    fontSize: 11,
    letterSpacing: "0.12em",
    background: "#ff2d2d18",
    color: "#ff2d2d",
  } as React.CSSProperties,
  btnGhost: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #ffffff18",
    cursor: "pointer",
    fontFamily: "inherit",
    fontWeight: 700,
    fontSize: 10,
    letterSpacing: "0.1em",
    background: "transparent",
    color: "#ffffff66",
  } as React.CSSProperties,
};

export default function AdminUploadPage() {
  const [adminKey, setAdminKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [resetStatus, setResetStatus] = useState<ResetStatus>("idle");
  const [resetResult, setResetResult] = useState<Record<string, number> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Drag-drop ──────────────────────────────────────────────────────────────
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith(".csv")) setFile(dropped);
    else alert("Please drop a .csv file");
  }, []);

  // ── Upload ─────────────────────────────────────────────────────────────────
  async function handleUpload() {
    if (!file) return;
    if (!adminKey.trim()) {
      alert("Enter your admin key first");
      return;
    }

    setUploadStatus("uploading");
    setUploadResult(null);
    setUploadError("");

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/admin/upload", {
        method: "POST",
        headers: { "x-admin-key": adminKey },
        body: form,
      });

      const json = await res.json();
      if (!res.ok) {
        setUploadStatus("error");
        setUploadError(json.error ?? `HTTP ${res.status}`);
        return;
      }

      setUploadStatus("success");
      setUploadResult(json.summary);
      setFile(null);
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  // ── Reset ──────────────────────────────────────────────────────────────────
  async function handleReset() {
    if (resetStatus === "idle") {
      setResetStatus("confirming");
      return;
    }
    if (resetStatus !== "confirming") return;

    if (!adminKey.trim()) {
      alert("Enter your admin key first");
      setResetStatus("idle");
      return;
    }

    setResetStatus("resetting");
    try {
      const res = await fetch("/api/admin/reset", {
        method: "DELETE",
        headers: { "x-admin-key": adminKey },
      });
      const json = await res.json();
      if (!res.ok) {
        setResetStatus("error");
        setUploadError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setResetStatus("done");
      setResetResult(json.deleted);
    } catch (err) {
      setResetStatus("error");
      setUploadError(err instanceof Error ? err.message : "Unknown error");
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "jagaid-template.csv";
    a.click();
  }

  return (
    <div style={s.root}>
      <div style={s.wrap}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.2em",
              color: "#00ff8888",
              marginBottom: 10,
            }}
          >
            ADMIN PANEL
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>
            ⚔ JagaID <span style={{ color: "#00ff88" }}>Data Upload</span>
          </h1>
          <p style={{ fontSize: 11, color: "#ffffff44", margin: 0 }}>
            Upload CSV dari OJK atau sumber lain langsung ke Supabase
          </p>
        </div>

        {/* Admin Key */}
        <div style={s.card}>
          <label style={s.label}>ADMIN KEY</label>
          <input
            style={s.input}
            type="password"
            data-testid="input-admin-key"
            placeholder="Masukkan ADMIN_UPLOAD_KEY dari environment variables"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
          />
          <div style={{ fontSize: 10, color: "#ffffff28", marginTop: 8 }}>
            Set <code style={{ color: "#00ff8866" }}>ADMIN_UPLOAD_KEY</code> di Vercel
            Environment Variables → redeploy
          </div>
        </div>

        {/* CSV Upload */}
        <div style={s.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Upload CSV</div>
            <button
              data-testid="btn-download-template"
              style={s.btnGhost}
              onClick={downloadTemplate}
            >
              ⬇ Download Template
            </button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            data-testid="drop-zone"
            onDrop={onDrop}
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${dragging ? "#00ff88" : file ? "#00ff8866" : "#ffffff18"}`,
              borderRadius: 12,
              padding: "32px 20px",
              textAlign: "center",
              cursor: "pointer",
              background: dragging ? "#00ff8808" : file ? "#00ff8804" : "transparent",
              transition: "all 0.2s",
              marginBottom: 16,
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              style={{ display: "none" }}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file ? (
              <div>
                <div style={{ fontSize: 24, marginBottom: 8 }}>📄</div>
                <div style={{ fontSize: 13, color: "#00ff88", fontWeight: 700 }}>
                  {file.name}
                </div>
                <div style={{ fontSize: 10, color: "#ffffff44", marginTop: 4 }}>
                  {(file.size / 1024).toFixed(1)} KB — klik untuk ganti
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
                <div style={{ fontSize: 12, color: "#ffffff66" }}>
                  Drag & drop CSV atau klik untuk pilih file
                </div>
                <div style={{ fontSize: 10, color: "#ffffff28", marginTop: 6 }}>
                  Format: type, value, bank, scam_type
                </div>
              </div>
            )}
          </div>

          {/* CSV format reminder */}
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              background: "#ffffff06",
              marginBottom: 16,
              fontSize: 10,
              color: "#ffffff44",
              lineHeight: 1.8,
            }}
          >
            <div style={{ color: "#00ff8888", marginBottom: 4 }}>FORMAT CSV:</div>
            <div>type,value,bank,scam_type</div>
            <div>domain,investasi-bodong.com,,Investasi Bodong</div>
            <div>bank_account,1234567890,BRI,Transfer Penipuan</div>
            <div>phone,08123456789,,Phishing</div>
          </div>

          <button
            data-testid="btn-upload"
            style={{
              ...s.btnPrimary,
              width: "100%",
              opacity: !file || uploadStatus === "uploading" ? 0.5 : 1,
            }}
            onClick={handleUpload}
            disabled={!file || uploadStatus === "uploading"}
          >
            {uploadStatus === "uploading" ? "MENGUPLOAD..." : "UPLOAD KE SUPABASE →"}
          </button>

          {/* Upload results */}
          {uploadStatus === "success" && uploadResult && (
            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 10,
                background: "#30d15818",
                border: "1px solid #30d15844",
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#30d158",
                  marginBottom: 8,
                }}
              >
                ✅ Upload berhasil
              </div>
              <div style={{ fontSize: 11, color: "#ffffff88", lineHeight: 1.8 }}>
                <div>
                  Total baris CSV :{" "}
                  <span style={{ color: "#fff" }}>{uploadResult.total_rows}</span>
                </div>
                <div>
                  Entitas diproses :{" "}
                  <span style={{ color: "#00ff88" }}>
                    {uploadResult.entities_processed}
                  </span>
                </div>
                <div>
                  Laporan ditambahkan:{" "}
                  <span style={{ color: "#00c8ff" }}>{uploadResult.reports_added}</span>
                </div>
                <div>
                  Dilewati :{" "}
                  <span style={{ color: "#ff9500" }}>{uploadResult.skipped}</span>
                </div>
              </div>
              {uploadResult.errors && (
                <div style={{ marginTop: 8, fontSize: 10, color: "#ff2d2d88" }}>
                  {uploadResult.errors.map((e, i) => (
                    <div key={i}>⚠ {e}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          {uploadStatus === "error" && (
            <div
              style={{
                marginTop: 16,
                padding: "12px 16px",
                borderRadius: 10,
                background: "#ff2d2d0f",
                border: "1px solid #ff2d2d44",
              }}
            >
              <div style={{ fontSize: 11, color: "#ff2d2d" }}>✗ Error: {uploadError}</div>
            </div>
          )}
        </div>

        {/* Reset section */}
        <div style={{ ...s.card, border: "1px solid #ff2d2d22" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 6 }}>
            Reset Database
          </div>
          <div style={{ fontSize: 11, color: "#ffffff44", marginBottom: 16 }}>
            Hapus semua baris dari <code style={{ color: "#ff2d2d88" }}>reports</code>,{" "}
            <code style={{ color: "#ff2d2d88" }}>connections</code>, dan{" "}
            <code style={{ color: "#ff2d2d88" }}>entities</code>. Tidak bisa diurungkan.
          </div>

          {resetStatus === "done" && resetResult && (
            <div
              style={{
                padding: "12px 16px",
                borderRadius: 10,
                background: "#30d15810",
                border: "1px solid #30d15833",
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#30d158",
                  fontWeight: 700,
                  marginBottom: 6,
                }}
              >
                ✅ Database berhasil dikosongkan
              </div>
              {Object.entries(resetResult).map(([t, n]) => (
                <div key={t} style={{ fontSize: 10, color: "#ffffff66" }}>
                  {t}: {n} baris dihapus
                </div>
              ))}
            </div>
          )}

          {resetStatus === "error" && (
            <div
              style={{
                padding: "12px",
                borderRadius: 8,
                background: "#ff2d2d0f",
                border: "1px solid #ff2d2d33",
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 11, color: "#ff2d2d" }}>✗ {uploadError}</div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10 }}>
            {resetStatus === "confirming" ? (
              <>
                <button
                  data-testid="btn-reset-confirm"
                  style={{ ...s.btnDanger, flex: 1 }}
                  onClick={handleReset}
                >
                  ⚠ YA, HAPUS SEMUA DATA
                </button>
                <button
                  data-testid="btn-reset-cancel"
                  style={s.btnGhost}
                  onClick={() => setResetStatus("idle")}
                >
                  Batal
                </button>
              </>
            ) : (
              <button
                data-testid="btn-reset"
                style={{ ...s.btnDanger, opacity: resetStatus === "resetting" ? 0.5 : 1 }}
                onClick={handleReset}
                disabled={resetStatus === "resetting"}
              >
                {resetStatus === "resetting" ? "MENGHAPUS..." : "🗑 RESET DATABASE"}
              </button>
            )}
          </div>

          {resetStatus === "confirming" && (
            <div style={{ marginTop: 10, fontSize: 10, color: "#ff9500" }}>
              ⚠ Semua data akan dihapus permanen. Pastikan sudah backup CSV sebelumnya.
            </div>
          )}
        </div>

        {/* Workflow guide */}
        <div style={{ ...s.card, border: "1px solid #00ff8812" }}>
          <div
            data-testid="workflow-section"
            style={{
              fontSize: 11,
              letterSpacing: "0.12em",
              color: "#00ff8888",
              marginBottom: 14,
            }}
          >
            ALUR KERJA
          </div>
          {[
            ["1", "Reset database", "Klik Reset Database untuk hapus seed data lama"],
            [
              "2",
              "Siapkan CSV",
              "Download template → isi data OJK → simpan sebagai .csv",
            ],
            ["3", "Upload", "Drag & drop file CSV → klik Upload ke Supabase"],
            ["4", "Verifikasi", "Buka app dan cek salah satu entry untuk konfirmasi"],
          ].map(([num, title, desc]) => (
            <div key={num} style={{ display: "flex", gap: 14, marginBottom: 14 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  background: "#00ff8818",
                  border: "1px solid #00ff8844",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 10,
                  color: "#00ff88",
                  flexShrink: 0,
                  fontWeight: 700,
                }}
              >
                {num}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: "#fff",
                    fontWeight: 700,
                    marginBottom: 2,
                  }}
                >
                  {title}
                </div>
                <div style={{ fontSize: 10, color: "#ffffff44" }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        input::placeholder { color: #ffffff28; }
        input:focus { border-color: #00ff8844 !important; }
        button:disabled { cursor: not-allowed; }
      `}</style>
    </div>
  );
}
