-- Column-level data classification for SOC 2 / GDPR audits.
--
-- Two namespaces:
--   PII:high   — direct identifiers or sensitive personal content (emails,
--                document bodies, beneficiary data)
--   PII:medium — quasi-identifiers (names, filenames, IP addresses)
--   PII:low    — non-identifying personal preferences (avatar URL, locale)
--   SECRET:high — auth credentials (OAuth tokens, session keys)
--
-- Inventory query:
--   select c.table_name, c.column_name, pgd.description
--   from information_schema.columns c
--   join pg_catalog.pg_statio_all_tables st
--     on st.schemaname = c.table_schema and st.relname = c.table_name
--   join pg_catalog.pg_description pgd
--     on pgd.objoid = st.relid and pgd.objsubid = c.ordinal_position
--   where pgd.description like 'PII:%' or pgd.description like 'SECRET:%'
--   order by c.table_name, c.column_name;
--
-- Idempotent — `comment on` is replace-or-create.

-- ── Identity ─────────────────────────────────────────────────────────────

comment on column users.email is 'PII:high';
comment on column users.name is 'PII:medium';
comment on column users.image is 'PII:low';
comment on column users.timezone is 'PII:low';
comment on column users.locale is 'PII:low';

comment on column attorney_profiles.bar_number is 'PII:medium';
comment on column attorney_profiles.bar_states is 'PII:low';
comment on column attorney_profiles.agreement_storage_path is 'PII:medium';

comment on column organizations.billing_email is 'PII:high';

-- ── Auth.js tables (auth credentials, not protected by RLS) ─────────────

comment on column accounts.provider_account_id is 'PII:medium';
comment on column accounts.refresh_token is 'SECRET:high';
comment on column accounts.access_token is 'SECRET:high';
comment on column accounts.id_token is 'SECRET:high';
comment on column accounts.session_state is 'SECRET:medium';
comment on column sessions.session_token is 'SECRET:high';

-- ── Case content ────────────────────────────────────────────────────────

comment on column cases.beneficiary_data is 'PII:high';
comment on column cases.evidence_plan is 'PII:high';
comment on column cases.criteria_analysis is 'PII:high';
comment on column cases.document_checklist is 'PII:medium';

comment on column case_documents.original_filename is 'PII:medium';
comment on column case_documents.storage_path is 'PII:medium';
comment on column case_documents.extracted_text is 'PII:high';

comment on column case_outputs.title is 'PII:medium';
comment on column case_outputs.content is 'PII:high';
comment on column case_outputs.metadata is 'PII:high';

comment on column case_events.details is 'PII:high';

-- ── Logs / marketing ────────────────────────────────────────────────────

comment on column audit_log.details is 'PII:high';
comment on column audit_log.ip_address is 'PII:medium';
comment on column audit_log.user_agent is 'PII:medium';

comment on column waitlist_entries.email is 'PII:high';
comment on column waitlist_entries.name is 'PII:medium';
comment on column waitlist_entries.ip_address is 'PII:medium';
comment on column waitlist_entries.referrer is 'PII:low';
