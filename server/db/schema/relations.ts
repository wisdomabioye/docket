import { relations } from "drizzle-orm";
import { accounts, sessions, users } from "./auth";
import { attorneyProfiles, userRoles } from "./users";
import { organizationMembers, organizations } from "./organizations";
import {
  caseComputeLedger,
  caseDocuments,
  caseEvents,
  caseOutputs,
  caseParticipants,
  cases,
} from "./cases";
import { caseRecommenders } from "./recommenders";
import { auditLog } from "./audit";
import { signedDocuments } from "./signatures";

/**
 * Drizzle relations for `db.query.*.findMany({ with: { ... } })`.
 *
 * Co-located here (rather than per-file) to avoid circular imports between
 * table files — `auth.ts` declares `users`, but a "users hasMany cases"
 * relation would require `auth.ts` to import `cases.ts`, which in turn
 * imports `auth.ts`. Keeping every `relations()` definition in one leaf
 * module sidesteps the cycle.
 *
 * `relationName` disambiguates when two FKs from the same table point at
 * the same target (e.g., `user_roles.user_id` vs. `user_roles.granted_by`,
 * both → `users.id`).
 */

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  sessions: many(sessions),
  attorneyProfile: many(attorneyProfiles),
  rolesGranted: many(userRoles, { relationName: "userRole_user" }),
  rolesGrantedByMe: many(userRoles, { relationName: "userRole_grantedBy" }),
  organizationMemberships: many(organizationMembers, {
    relationName: "orgMember_user",
  }),
  invitationsSent: many(organizationMembers, {
    relationName: "orgMember_invitedBy",
  }),
  caseParticipations: many(caseParticipants, {
    relationName: "caseParticipant_user",
  }),
  participantsAdded: many(caseParticipants, {
    relationName: "caseParticipant_addedBy",
  }),
  documentsUploaded: many(caseDocuments),
  caseEventsActed: many(caseEvents),
  auditLogEntries: many(auditLog),
  beneficiaryOnCases: many(cases),
  signedDocuments: many(signedDocuments),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
    relationName: "userRole_user",
  }),
  grantedBy: one(users, {
    fields: [userRoles.grantedBy],
    references: [users.id],
    relationName: "userRole_grantedBy",
  }),
}));

export const attorneyProfilesRelations = relations(
  attorneyProfiles,
  ({ one }) => ({
    user: one(users, {
      fields: [attorneyProfiles.userId],
      references: [users.id],
    }),
  }),
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  cases: many(cases),
}));

export const organizationMembersRelations = relations(
  organizationMembers,
  ({ one }) => ({
    organization: one(organizations, {
      fields: [organizationMembers.organizationId],
      references: [organizations.id],
    }),
    user: one(users, {
      fields: [organizationMembers.userId],
      references: [users.id],
      relationName: "orgMember_user",
    }),
    invitedBy: one(users, {
      fields: [organizationMembers.invitedBy],
      references: [users.id],
      relationName: "orgMember_invitedBy",
    }),
  }),
);

export const casesRelations = relations(cases, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [cases.organizationId],
    references: [organizations.id],
  }),
  beneficiary: one(users, {
    fields: [cases.beneficiaryUserId],
    references: [users.id],
  }),
  participants: many(caseParticipants),
  documents: many(caseDocuments),
  outputs: many(caseOutputs),
  recommenders: many(caseRecommenders),
  events: many(caseEvents),
  computeLedger: many(caseComputeLedger),
}));

export const caseParticipantsRelations = relations(
  caseParticipants,
  ({ one }) => ({
    case: one(cases, {
      fields: [caseParticipants.caseId],
      references: [cases.id],
    }),
    user: one(users, {
      fields: [caseParticipants.userId],
      references: [users.id],
      relationName: "caseParticipant_user",
    }),
    addedBy: one(users, {
      fields: [caseParticipants.addedBy],
      references: [users.id],
      relationName: "caseParticipant_addedBy",
    }),
  }),
);

export const caseDocumentsRelations = relations(caseDocuments, ({ one }) => ({
  case: one(cases, {
    fields: [caseDocuments.caseId],
    references: [cases.id],
  }),
  uploadedBy: one(users, {
    fields: [caseDocuments.uploadedBy],
    references: [users.id],
  }),
}));

export const caseOutputsRelations = relations(caseOutputs, ({ one, many }) => ({
  case: one(cases, {
    fields: [caseOutputs.caseId],
    references: [cases.id],
  }),
  computeEntries: many(caseComputeLedger),
}));

export const caseEventsRelations = relations(caseEvents, ({ one }) => ({
  case: one(cases, {
    fields: [caseEvents.caseId],
    references: [cases.id],
  }),
  actor: one(users, {
    fields: [caseEvents.actorUserId],
    references: [users.id],
  }),
}));

export const caseComputeLedgerRelations = relations(
  caseComputeLedger,
  ({ one }) => ({
    case: one(cases, {
      fields: [caseComputeLedger.caseId],
      references: [cases.id],
    }),
    output: one(caseOutputs, {
      fields: [caseComputeLedger.outputId],
      references: [caseOutputs.id],
    }),
  }),
);

export const caseRecommendersRelations = relations(
  caseRecommenders,
  ({ one }) => ({
    case: one(cases, {
      fields: [caseRecommenders.caseId],
      references: [cases.id],
    }),
    recommenderUser: one(users, {
      fields: [caseRecommenders.recommenderUserId],
      references: [users.id],
    }),
  }),
);

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  actor: one(users, {
    fields: [auditLog.actorUserId],
    references: [users.id],
  }),
}));

export const signedDocumentsRelations = relations(
  signedDocuments,
  ({ one }) => ({
    user: one(users, {
      fields: [signedDocuments.userId],
      references: [users.id],
    }),
  }),
);
