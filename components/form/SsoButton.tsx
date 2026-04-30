import { signIn } from "@/server/auth/config";

/**
 * Stage 00c form composite — single OAuth provider button. Server-action
 * form so no client JS is required; matches the visual language used by
 * `/login` (full-width, bordered, hover-inverts to ink).
 *
 * `provider` must be one of the names registered in
 * `server/auth/config.ts` (currently `google` and `microsoft-entra-id`).
 * Mismatched names fail at runtime with a clear Auth.js error; we don't
 * try to enumerate them here so adding a provider in Stage 11 doesn't
 * require touching this file.
 */
export type SsoButtonProps = {
  provider: string;
  label: string;
  callbackUrl: string;
};

export function SsoButton(props: SsoButtonProps): React.ReactElement {
  return (
    <form
      action={async () => {
        "use server";
        await signIn(props.provider, { redirectTo: props.callbackUrl });
      }}
    >
      <button
        type="submit"
        className="w-full rounded-md border border-[var(--color-ink)] bg-white px-4 py-3 text-sm font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-ink)] hover:text-[var(--color-cream)]"
      >
        {props.label}
      </button>
    </form>
  );
}
