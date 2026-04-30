// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OutputEditorToolbar } from "@/components/output/OutputEditorToolbar";

afterEach(() => cleanup());

/**
 * Toolbar is a thin shell around `editor.chain().focus().toggleX().run()`
 * — tests assert that each button (a) labels itself for screen readers,
 * (b) routes its click to the correct chain, (c) reflects `isActive` via
 * aria-pressed, (d) disables when the editor is null or `disabled` is set.
 *
 * The Tiptap editor is mocked with a chainable spy — running the chain
 * just records the leaf command name so we can assert routing.
 */

type ChainCalls = string[];

function makeEditor(opts?: {
  active?: Set<string>;
  canUndo?: boolean;
  canRedo?: boolean;
}) {
  const calls: ChainCalls = [];
  const active = opts?.active ?? new Set<string>();
  const chain = (): unknown => {
    const ctx = {
      focus: () => ctx,
      toggleBold: () => {
        calls.push("bold");
        return ctx;
      },
      toggleItalic: () => {
        calls.push("italic");
        return ctx;
      },
      toggleStrike: () => {
        calls.push("strike");
        return ctx;
      },
      toggleHeading: ({ level }: { level: number }) => {
        calls.push(`h${level}`);
        return ctx;
      },
      toggleBulletList: () => {
        calls.push("bulletList");
        return ctx;
      },
      toggleOrderedList: () => {
        calls.push("orderedList");
        return ctx;
      },
      toggleBlockquote: () => {
        calls.push("blockquote");
        return ctx;
      },
      undo: () => {
        calls.push("undo");
        return ctx;
      },
      redo: () => {
        calls.push("redo");
        return ctx;
      },
      extendMarkRange: () => ctx,
      setLink: ({ href }: { href: string }) => {
        calls.push(`setLink:${href}`);
        return ctx;
      },
      unsetLink: () => {
        calls.push("unsetLink");
        return ctx;
      },
      run: () => true,
    };
    return ctx;
  };
  return {
    calls,
    editor: {
      isActive: (name: string, attrs?: { level?: number }) => {
        const key =
          name === "heading" && attrs?.level ? `heading:${attrs.level}` : name;
        return active.has(key);
      },
      chain,
      can: () => ({
        undo: () => opts?.canUndo ?? true,
        redo: () => opts?.canRedo ?? true,
      }),
      getAttributes: () => ({}),
    } as unknown as Parameters<typeof OutputEditorToolbar>[0]["editor"],
  };
}

describe("OutputEditorToolbar — wiring", () => {
  it.each([
    ["Bold", "bold"],
    ["Italic", "italic"],
    ["Strike-through", "strike"],
    ["Heading 1", "h1"],
    ["Heading 2", "h2"],
    ["Heading 3", "h3"],
    ["Bullet list", "bulletList"],
    ["Numbered list", "orderedList"],
    ["Blockquote", "blockquote"],
    ["Undo", "undo"],
    ["Redo", "redo"],
  ])("routes the %s button to the %s command", (label, expected) => {
    const { calls, editor } = makeEditor();
    render(<OutputEditorToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByLabelText(label));
    expect(calls).toContain(expected);
  });

  it("Link button prompts for a URL and calls setLink with the entered http(s) value", () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockImplementation(() => "https://example.com/x");
    const { calls, editor } = makeEditor();
    render(<OutputEditorToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByLabelText("Insert / edit link"));
    expect(promptSpy).toHaveBeenCalled();
    expect(calls).toContain("setLink:https://example.com/x");
    promptSpy.mockRestore();
  });

  it("Link button rejects non-http(s) URLs (defensive sanitiser)", () => {
    const promptSpy = vi
      .spyOn(window, "prompt")
      .mockImplementation(() => "javascript:alert(1)");
    const { calls, editor } = makeEditor();
    render(<OutputEditorToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByLabelText("Insert / edit link"));
    expect(calls.some((c) => c.startsWith("setLink:"))).toBe(false);
    promptSpy.mockRestore();
  });

  it("Link button with empty string clears the existing link (unsetLink)", () => {
    const promptSpy = vi.spyOn(window, "prompt").mockImplementation(() => "");
    const { calls, editor } = makeEditor();
    render(<OutputEditorToolbar editor={editor} />);
    fireEvent.mouseDown(screen.getByLabelText("Insert / edit link"));
    expect(calls).toContain("unsetLink");
    promptSpy.mockRestore();
  });
});

describe("OutputEditorToolbar — state", () => {
  it("aria-pressed reflects isActive() per button", () => {
    const { editor } = makeEditor({ active: new Set(["bold", "heading:2"]) });
    render(<OutputEditorToolbar editor={editor} />);
    expect(screen.getByLabelText("Bold")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Italic")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByLabelText("Heading 2")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Heading 1")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("disables every button when editor is null (loading state)", () => {
    render(<OutputEditorToolbar editor={null} />);
    for (const btn of screen.getAllByRole("button")) {
      expect(btn).toBeDisabled();
    }
  });

  it("disables every button when `disabled` prop is true (read-only mode)", () => {
    const { editor } = makeEditor();
    render(<OutputEditorToolbar editor={editor} disabled />);
    for (const btn of screen.getAllByRole("button")) {
      expect(btn).toBeDisabled();
    }
  });

  it("undo / redo respect editor.can()", () => {
    const { editor } = makeEditor({ canUndo: false, canRedo: true });
    render(<OutputEditorToolbar editor={editor} />);
    expect(screen.getByLabelText("Undo")).toBeDisabled();
    expect(screen.getByLabelText("Redo")).not.toBeDisabled();
  });
});
