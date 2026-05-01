-- Stage 11 W5: trigram indexes for the global search bar.
--
-- Why trigrams (`pg_trgm`) and not full-text search (`tsvector`):
--   - Beneficiary names + filenames are short, mixed-case, often
--     non-English (Maria González, Søren Aalborg) — trigram similarity
--     handles diacritics + typos better than `to_tsvector` stemmers
--     tuned for English.
--   - Phase 1 corpus is small (a single attorney's caseload). A
--     trigram GIN index keeps inserts cheap and queries fast enough
--     for the topbar's autocomplete (target: <50ms p95).
--   - tsvector + GIN is the right call for Phase 2 once attorneys
--     index hundreds of MB of evidence. See open_issues for the
--     upgrade path.
--
-- `pg_trgm` extension is enabled by 0001_extensions.sql (idempotent
-- there too), so we don't re-create it here.
--
-- All indexes:
--   - lowercased so the lookup is case-insensitive without a separate
--     `ILIKE` step (matches `lower(query)` in the search procedure).
--   - `gin_trgm_ops` opclass (the only one valid for trigram GIN).
--   - `WHERE deleted_at IS NULL` partial-index predicate so soft-
--     deleted rows don't bloat the index AND don't accidentally leak
--     into search results when a query plan picks a path that doesn't
--     re-check the filter.
--   - `IF NOT EXISTS` so a re-run on an already-migrated DB is a no-op.
--
-- Cap on `extracted_text` (4000 chars):
--   - Without a cap, a 5MB OCR'd PDF would balloon the index by ~5MB
--     per document (trigram entries are roughly 1:1 with input chars).
--   - 4000 chars ≈ first ~600 words of a doc — catches CV summaries,
--     cover-letter openings, abstracts. Deep-document matches need
--     real FTS; deferred to Phase 2 (open_issues).
--   - `left(...)` returns the prefix without breaking on multi-byte
--     characters; safe for the encoded text we ingest.

create index if not exists cases_search_beneficiary_trgm_idx
  on cases
  using gin (lower((beneficiary_data ->> 'fullName')) gin_trgm_ops)
  where deleted_at is null;

create index if not exists case_documents_search_filename_trgm_idx
  on case_documents
  using gin (lower(original_filename) gin_trgm_ops)
  where deleted_at is null;

create index if not exists case_documents_search_extracted_trgm_idx
  on case_documents
  using gin (lower(left(extracted_text, 4000)) gin_trgm_ops)
  where deleted_at is null and extracted_text is not null;
