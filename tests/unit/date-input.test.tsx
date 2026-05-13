// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { DateInput } from "@/components/ui/DateInput";

afterEach(() => cleanup());

describe("DateInput", () => {
  it("commits a typed valid date via blur", () => {
    const onChange = vi.fn();
    render(<DateInput value="" onChange={onChange} aria-label="DOB" />);
    const input = screen.getByLabelText("DOB");
    fireEvent.change(input, { target: { value: "01/15/1990" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith("1990-01-15");
  });

  it("fires onInvalid with 'invalid_date' for an unparseable entry", () => {
    const onChange = vi.fn();
    const onInvalid = vi.fn();
    render(
      <DateInput
        value=""
        onChange={onChange}
        onInvalid={onInvalid}
        aria-label="DOB"
      />,
    );
    const input = screen.getByLabelText("DOB");
    // Feb 30, 1990 — JS Date rolls these over; parseMaskedDate rejects.
    fireEvent.change(input, { target: { value: "02/30/1990" } });
    fireEvent.blur(input);
    expect(onInvalid).toHaveBeenCalledWith("invalid_date");
    // Form state never holds a bad value.
    expect(onChange).not.toHaveBeenCalledWith("1990-02-30");
  });

  it("fires onInvalid with 'out_of_range' when before min", () => {
    const onChange = vi.fn();
    const onInvalid = vi.fn();
    render(
      <DateInput
        value=""
        onChange={onChange}
        onInvalid={onInvalid}
        min="2030-01-01"
        aria-label="Filing"
      />,
    );
    const input = screen.getByLabelText("Filing");
    fireEvent.change(input, { target: { value: "01/15/2020" } });
    fireEvent.blur(input);
    expect(onInvalid).toHaveBeenCalledWith("out_of_range");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("fires onInvalid with 'out_of_range' when after max", () => {
    const onChange = vi.fn();
    const onInvalid = vi.fn();
    render(
      <DateInput
        value=""
        onChange={onChange}
        onInvalid={onInvalid}
        max="2020-01-01"
        aria-label="DOB"
      />,
    );
    const input = screen.getByLabelText("DOB");
    fireEvent.change(input, { target: { value: "01/15/2030" } });
    fireEvent.blur(input);
    expect(onInvalid).toHaveBeenCalledWith("out_of_range");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("flips aria-invalid when `invalid` is true", () => {
    render(<DateInput value="" onChange={vi.fn()} invalid aria-label="DOB" />);
    expect(screen.getByLabelText("DOB").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("does not set aria-invalid by default", () => {
    render(<DateInput value="" onChange={vi.fn()} aria-label="DOB" />);
    expect(screen.getByLabelText("DOB").getAttribute("aria-invalid")).not.toBe(
      "true",
    );
  });

  it("forwards aria-describedby for error/hint linkage", () => {
    render(
      <>
        <DateInput
          value=""
          onChange={vi.fn()}
          aria-label="DOB"
          aria-describedby="dob-err"
        />
        <p id="dob-err">required</p>
      </>,
    );
    expect(
      screen.getByLabelText("DOB").getAttribute("aria-describedby"),
    ).toBe("dob-err");
  });

  it("empty string clears via onChange — no onInvalid fire", () => {
    const onChange = vi.fn();
    const onInvalid = vi.fn();
    render(
      <DateInput
        value="1990-01-15"
        onChange={onChange}
        onInvalid={onInvalid}
        aria-label="DOB"
      />,
    );
    const input = screen.getByLabelText("DOB");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("");
    expect(onInvalid).not.toHaveBeenCalled();
  });
});
