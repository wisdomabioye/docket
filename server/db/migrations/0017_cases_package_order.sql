-- Stage 11 γ: persistent per-case package order.
--
-- Stores the attorney's drag-to-reorder choice as a `text[]` of
-- `outputType:subgroupKey` keys (or just `outputType` for unsubgrouped
-- outputs). NULL = no override; the PDF service falls through to the
-- hardcoded `packageOrderRank` array.
--
-- Why `text[]` not `uuid[]`: `case_outputs` rows are versioned —
-- regenerating an output produces a new id. Persisting ids would
-- silently drop the entry on every regen. Type+subgroup is stable.
--
-- Idempotent — `add column if not exists`.

alter table cases add column if not exists package_order text[];
