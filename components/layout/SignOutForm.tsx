import { signOut } from "@/server/auth/config";
import { APP_ROUTES } from "@/config";

/**
 * Stage 00c bottom-of-page sign-out trigger. Renders as an underlined
 * text button inside a server-action form so no client JS is needed.
 * `redirectTo` defaults to the public landing page; pass a different
 * destination if a flow needs to route somewhere else after logout.
 */
export type SignOutFormProps = {
  redirectTo?: string;
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
        className="text-xs text-[var(--color-ink-muted)] underline"
      >
        {props.label ?? "Sign out"}
      </button>
    </form>
  );
}
