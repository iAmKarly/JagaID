import { z } from "zod";
import { normalizeQuery } from "./lookup";

export const EntityTypeSchema = z.enum([
  "bank_account",
  "phone",
  "ewallet",
  "domain",
]);

export const ScamTypeSchema = z.enum([
  "Transfer Penipuan",
  "Investasi Bodong",
  "Phishing",
  "COD Palsu",
  "Pinjol Ilegal",
  "Belanja Online",
  "Lowongan Kerja Palsu",
  "Lainnya",
]);

export const ReportPayloadSchema = z.object({
  type: EntityTypeSchema,
  value: z
    .string()
    .min(5, "Value terlalu pendek")
    .max(200, "Value terlalu panjang")
    .transform(normalizeQuery),
  bank: z.string().max(50, "Nama bank terlalu panjang").optional(),
  scam_type: ScamTypeSchema,
  amount: z.string().max(50, "Nominal terlalu panjang").optional(),
  description: z
    .string()
    .min(10, "Deskripsi terlalu pendek — minimal 10 karakter")
    .max(2000, "Deskripsi terlalu panjang")
    .trim(),
});

export const LookupQuerySchema = z.object({
  q: z
    .string()
    .min(5, "Query terlalu pendek")
    .max(200, "Query terlalu panjang")
    .transform(normalizeQuery),
});
