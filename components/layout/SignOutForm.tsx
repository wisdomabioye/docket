import { signOut } from "@/server/auth/config";
import { APP_ROUTES } from "@/config";
import { Icon } from "@/components/ui";

/**
 * Sidebar-footer sign-out button. Server-action form so no client JS
 * is needed.
 *
 * Visual: bordered pill with a `log-out` icon, sized to read clearly
 * against the dark sidebar surface. The previous variant rendered as a
 * muted underline-only "Out" link that was easy to miss; this version
 * is a real button affordance.
 */
export type SignOutFormProps = {
  /** Where to land after sign-out. Defaults to the public landing. */
  redirectTo?: string;
  /** Button text. Defaults to "Sign out". Pass a shorter label when
   *  the rail is narrow. */
  label?: string;
};

export function SignOutForm(props: SignOutFormProps): React.ReactElement {
  const target = props.redirectTo ?? APP_ROUTES.home;
  return (
    <form
      action={async () => {
        "use server";
        await signOut({ redirectTo: target });
      }}
    >
      <button
        type="submit"
        aria-label="Sign out"
        className="inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider transition hover:bg-[rgba(245,241,232,0.08)]"
        style={{
          borderColor: "rgba(245,241,232,0.28)",
          color: "rgba(245,241,232,0.92)",
        }}
      >
        <Icon name="log-out" size={12} />
        {props.label ?? "Sign out"}
      </button>
    </form>
  );
}
