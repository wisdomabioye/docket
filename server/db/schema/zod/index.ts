/**
 * Zod schemas for jsonb columns. **Source of truth** for what's inside each
 * blob — Drizzle only knows the column is jsonb and links the inferred type
 * via `.$type<...>()` on the table column.
 *
 * Validate at the service-layer boundary on every read/write:
 *
 *   import { BeneficiaryDataSchema } from "@/server/db/schema/zod";
 *   const parsed = BeneficiaryDataSchema.parse(row.beneficiaryData);
 *
 * For row-shape validation (full insert/select shapes), Stage 02 will adopt
 * `drizzle-zod` (`createInsertSchema(users)`) which derives Zod from Drizzle
 * — eliminates drift on relational columns.
 */

export * from "./beneficiary";
export * from "./evidence-plan";
export * from "./criteria-analysis";
export * from "./document-checklist";
export * from "./output-metadata";
export * from "./audit-details";
