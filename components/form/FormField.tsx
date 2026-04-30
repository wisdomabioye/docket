import type { ReactNode } from "react";

/**
 * Stage 00c form composite — label + control + helper/error wrapper.
 * Pure server component (no `useId`, no client state) so it composes
 * inside RSC pages without a `"use client"` boundary. Functions can't
 * cross the RSC boundary; that's why the API is "caller passes the
 * control as `children` AND threads the `id` through to it" rather
 * than a render-prop.
 *
 * Usage:
 *   <FormField id="bar-number" label="Bar number" hint="State + 6 digits">
 *     <input id="bar-number" className="..." />
 *   </FormField>
 *
 * The `id` is required so screen readers announce the label correctly
 * via `htmlFor`. The caller is responsible for pinning the same id on
 * the inner control — eslint-plugin-jsx-a11y `label-has-associated-control`
 * catches mismatches.
 */
export type FormFieldProps = {
  /** Stable id pinned on both the `<label htmlFor>` and the inner control. */
  id: string;
  label: string;
  /** Helper text rendered under the field in muted color. */
  hint?: ReactNode;
  /** Error text rendered under the field in alert color. Takes
   *  precedence over `hint`; ARIA role="alert" so screen readers
   *  announce on first appearance. */
  error?: string;
  required?: boolean;
  children: ReactNode;
};

export function FormField(props: FormFieldProps): React.ReactElement {
  return (
    <div className="space-y-1.5" data-component="form-field">
      <label
        htmlFor={props.id}
        className="block text-xs font-medium text-[var(--color-ink)]"
      >
        {props.label}
        {props.required ? (
          <span aria-hidden="true" className="ml-0.5 text-[var(--color-ink-muted)]">
            *
          </span>
        ) : null}
      </label>
      {props.children}
      {props.error ? (
        <p
          role="alert"
          className="text-xs"
          style={{ color: "var(--danger, #b1330e)" }}
        >
          {props.error}
        </p>
      ) : props.hint ? (
        <p className="text-xs text-[var(--color-ink-muted)]">{props.hint}</p>
      ) : null}
    </div>
  );
}
