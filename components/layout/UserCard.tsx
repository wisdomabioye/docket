import { SignOutForm } from "./SignOutForm";

/**
 * Sidebar-footer user identity block. Initials avatar + name/email
 * stack + sign-out button. Used by both the attorney workspace shell
 * (`app/(app)/(workspace)/layout.tsx`) and the admin shell
 * (`app/(admin)/layout.tsx`) so the affordance is identical in both
 * areas.
 *
 * Pure server component — no state, no client JS beyond the
 * underlying `SignOutForm`'s server action.
 */
export type UserCardProps = {
  name: string;
  email: string;
};

export function UserCard(props: UserCardProps): React.ReactElement {
  const initials = props.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join("");
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-sm text-[11px] font-medium"
          style={{
            background: "rgba(245,241,232,0.12)",
            color: "rgba(245,241,232,0.92)",
          }}
        >
          {initials || "·"}
        </span>
        <div className="min-w-0 flex-1 text-[12px] leading-tight">
          <p className="truncate font-medium" style={{ color: "var(--cream)" }}>
            {props.name}
          </p>
          <p
            className="truncate"
            style={{ color: "rgba(245,241,232,0.55)" }}
          >
            {props.email}
          </p>
        </div>
      </div>
      <SignOutForm />
    </div>
  );
}
