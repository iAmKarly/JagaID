import { Database } from "@/types";

export const SEED_DB: Database = {
  entities: [
    {
      // e1: "1234567890" — BAHAYA TINGGI (score=99) with current recency
      // reportScore = min(20×4, 60) = 60
      // networkScore = min(3×8, 24) = 24  ← 3 connections required
      // recencyScore = 15 (within 30 days)
      // total = 99 → BAHAYA TINGGI ✓
      id: "e1",
      type: "bank_account",
      value: "1234567890",
      bank: "BRI",
      reports: 20,
      connected: ["e2", "e3", "e5"],
      last_seen: new Date(Date.now() - 5 * 86_400_000)
        .toISOString()
        .split("T")[0],
    },
    {
      id: "e2",
      type: "phone",
      value: "08123456789",
      reports: 9,
      connected: ["e1", "e4"],
      last_seen: new Date(Date.now() - 10 * 86_400_000)
        .toISOString()
        .split("T")[0],
    },
    {
      id: "e3",
      type: "ewallet",
      value: "gopay:08123456789",
      reports: 5,
      connected: ["e1"],
      last_seen: new Date(Date.now() - 45 * 86_400_000)
        .toISOString()
        .split("T")[0],
    },
    {
      id: "e4",
      type: "bank_account",
      value: "9876543210",
      bank: "BCA",
      reports: 3,
      connected: ["e2"],
      last_seen: new Date(Date.now() - 100 * 86_400_000)
        .toISOString()
        .split("T")[0],
    },
    {
      id: "e5",
      type: "domain",
      value: "investasicepat.com",
      reports: 22,
      connected: ["e1"],
      last_seen: new Date(Date.now() - 2 * 86_400_000)
        .toISOString()
        .split("T")[0],
    },
    {
      id: "e6",
      type: "bank_account",
      value: "1111111111",
      bank: "Mandiri",
      reports: 1,
      connected: [],
      last_seen: new Date(Date.now() - 200 * 86_400_000)
        .toISOString()
        .split("T")[0],
    },
  ],
  reports: [
    {
      id: "r1",
      entity_id: "e1",
      type: "Transfer Penipuan",
      amount: "Rp 2.500.000",
      date: "2024-12-01",
      description: "Modus COD palsu, barang tidak dikirim setelah transfer.",
    },
    {
      id: "r2",
      entity_id: "e1",
      type: "Investasi Bodong",
      amount: "Rp 15.000.000",
      date: "2024-11-25",
      description: "Iming-iming profit 30% per bulan, lalu kabur.",
    },
    {
      id: "r3",
      entity_id: "e2",
      type: "Phishing",
      amount: "Rp 5.000.000",
      date: "2024-11-28",
      description: "SMS mengaku dari bank, minta OTP.",
    },
  ],
};
