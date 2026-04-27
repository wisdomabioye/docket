import {
  index,
  inet,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { eventActorTypeEnum } from "./enums";
import { users } from "./auth";
import type { AuditDetails } from "./zod";

/**
 * Append-only audit trail. Renamed from the original plan's
 * `admin_audit_log` to a generic `audit_log` because at consumer scale we
 * audit more than admin actions (every ownership change, status flip,
 * money movement, RBAC change).
 *
 * `targetType` is a free-text discriminator (e.g., 'case', 'user',
 * 'invoice'); `targetId` is the row uuid. This is a type-erased FK — DB
 * cannot enforce that targetId points anywhere real. Service layer must
 * be careful.
 *
 * `details` carries action-specific data, validated by an
 * `AuditDetailsSchema` Zod schema at the boundary.
 *
 * No soft-delete, no updates. Retention partitioning lands in Phase 2.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorType: eventActorTypeEnum("actor_type").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    details: jsonb("details").$type<AuditDetails>(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("audit_log_actor_created_idx").on(t.actorUserId, t.createdAt),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
    index("audit_log_action_idx").on(t.action),
  ],
);
