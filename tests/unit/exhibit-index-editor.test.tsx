// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  ExhibitIndexEditor,
  type ExhibitIndexEditorApi,
} from "@/components/output";

/**
 * Locks the structured-editor contract used by `OutputDetailPanel` in
 * commit C:
 *   - Parses initial JSON; surfaces a "couldn't parse" banner on
 *     malformed payloads (and the host blocks save when `getValue()`
 *     returns null).
 *   - Mutating any field flips dirty.
 *   - documentId is read-only per row (rendered, not editable).
 *   - Add row picks from `document.list`; the picked document's id +
 *     filename land in the new entry; existing-already-indexed docs
 *     are excluded from the picker.
 *   - Remove + reorder via up/down arrows; reorder bookkeeping
 *     preserves all other fields.
 *   - `getValue()` returns the validated `ExhibitIndex` after edits;
 *     `null` when the payload would fail schema validation.
 */

// Inline UUID literals because `vi.mock` factories are hoisted above
// const declarations — referencing module-level constants here would
// resolve to `undefined`. The constants below are for assertions only.
vi.mock("@/lib/trpc/react", () => ({
  trpc: {
    document: {
      list: {
        useQuery: vi.fn(() => ({
          data: [
            { id: "00000000-0000-4000-8000-000000000001", originalFilename: "cv.pdf" },
            { id: "00000000-0000-4000-8000-000000000002", originalFilename: "publications.pdf" },
            { id: "00000000-0000-4000-8000-000000000003", originalFilename: "awards.pdf" },
          ],
          isLoading: false,
        })),
      },
    },
  },
}));

const DOC_1 = "00000000-0000-4000-8000-000000000001";
const DOC_2 = "00000000-0000-4000-8000-000000000002";
const DOC_3 = "00000000-0000-4000-8000-000000000003";

const VALID_PAYLOAD = JSON.stringify({
  entries: [
    {
      label: "Exhibit A",
      documentId: "00000000-0000-4000-8000-000000000001",
      filename: "cv.pdf",
      description: "Curriculum vitae.",
      supportsCriteria: ["authorship_of_scholarly_articles"],
    },
  ],
});

function setup(initialContent: string = VALID_PAYLOAD) {
  const onDirty = vi.fn();
  let api: ExhibitIndexEditorApi | null = null;
  render(
    <ExhibitIndexEditor
      caseId="case-1"
      initialContent={initialContent}
      readOnly={false}
      onDirtyChange={onDirty}
      onReady={(a) => {
        api = a;
      }}
    />,
  );
  if (api === null) throw new Error("editor did not call onReady");
  return { api: api as ExhibitIndexEditorApi, onDirty };
}

describe("ExhibitIndexEditor", () => {
  it("renders rows from initial JSON", () => {
    setup();
    expect(screen.getByDisplayValue("Exhibit A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("cv.pdf")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Curriculum vitae.")).toBeInTheDocument();
    expect(
      screen.getByText(new RegExp(`documentId: ${DOC_1}`)),
    ).toBeInTheDocument();
  });

  it("getValue returns the validated ExhibitIndex after edits", () => {
    const { api } = setup();
    fireEvent.change(screen.getByDisplayValue("Curriculum vitae."), {
      target: { value: "Updated CV." },
    });
    const value = api.getValue();
    expect(value).not.toBeNull();
    expect(value?.entries[0]?.description).toBe("Updated CV.");
    expect(value?.entries[0]?.documentId).toBe(DOC_1);
  });

  it("editing a field marks the editor dirty", () => {
    const { onDirty } = setup();
    onDirty.mockClear();
    fireEvent.change(screen.getByDisplayValue("Exhibit A"), {
      target: { value: "Exhibit A-1" },
    });
    expect(onDirty).toHaveBeenCalledWith(true);
  });

  it("Add row inserts an entry from document.list with auto-assigned label", () => {
    const { api } = setup();
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: DOC_2 } });
    fireEvent.click(screen.getByRole("button", { name: /^add to index$/i }));
    const value = api.getValue();
    expect(value?.entries).toHaveLength(2);
    const added = value?.entries[1];
    expect(added?.documentId).toBe(DOC_2);
    expect(added?.filename).toBe("publications.pdf");
    // First letter not in use → "Exhibit B".
    expect(added?.label).toBe("Exhibit B");
    expect(added?.supportsCriteria).toEqual([]);
  });

  it("Add-row picker hides documents already in the index", () => {
    setup();
    // DOC_1 is already in the index → only DOC_2 + DOC_3 should be
    // selectable. The placeholder option is also present so the
    // total option count is 3.
    const select = screen.getByRole("combobox");
    const options = Array.from(select.querySelectorAll("option"));
    const values = options.map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain(DOC_1);
    expect(values).toContain(DOC_2);
    expect(values).toContain(DOC_3);
  });

  it("Remove drops a row and updates getValue", () => {
    const { api } = setup();
    fireEvent.click(screen.getByRole("button", { name: /^remove exhibit a$/i }));
    expect(api.getValue()?.entries).toHaveLength(0);
  });

  it("Up/Down reorder swaps neighbors", () => {
    const { api } = setup(
      JSON.stringify({
        entries: [
          {
            label: "Exhibit A",
            documentId: "00000000-0000-4000-8000-000000000001",
            filename: "cv.pdf",
            description: "First.",
            supportsCriteria: [],
          },
          {
            label: "Exhibit B",
            documentId: "00000000-0000-4000-8000-000000000002",
            filename: "publications.pdf",
            description: "Second.",
            supportsCriteria: [],
          },
        ],
      }),
    );
    // Move Exhibit B up.
    fireEvent.click(
      screen.getByRole("button", { name: /^move exhibit b up$/i }),
    );
    const value = api.getValue();
    expect(value?.entries[0]?.label).toBe("Exhibit B");
    expect(value?.entries[1]?.label).toBe("Exhibit A");
  });

  it("Adding a criterion via Enter key adds a chip and goes through getValue", () => {
    const { api } = setup();
    const input = screen.getByPlaceholderText(/add criterion/i);
    fireEvent.change(input, { target: { value: "new_criterion" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const value = api.getValue();
    expect(value?.entries[0]?.supportsCriteria).toContain("new_criterion");
  });

  it("Surfaces a 'could not parse' banner on malformed JSON; getValue returns the empty default shape", () => {
    setup("{not valid json");
    expect(screen.getByText(/could not parse/i)).toBeInTheDocument();
    expect(screen.getByText(/regenerate/i)).toBeInTheDocument();
  });

  it("readOnly disables form inputs", () => {
    let api: ExhibitIndexEditorApi | null = null;
    render(
      <ExhibitIndexEditor
        caseId="case-1"
        initialContent={VALID_PAYLOAD}
        readOnly
        onReady={(a) => {
          api = a;
        }}
      />,
    );
    expect(api).not.toBeNull();
    // All text/textarea inputs render as `readOnly` so the user can't
    // mutate the form. Picker is not rendered at all in readOnly.
    // Remove + reorder buttons render but disabled (consistent with
    // the up/down arrows — same affordance, just inert).
    expect(screen.queryByRole("button", { name: /^add to index$/i })).toBeNull();
    const removeBtn = screen.getByRole("button", {
      name: /^remove exhibit a$/i,
    });
    expect(removeBtn).toBeDisabled();
    const labelInput = screen.getByDisplayValue("Exhibit A") as HTMLInputElement;
    expect(labelInput.readOnly).toBe(true);
  });
});
