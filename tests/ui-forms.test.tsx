// @vitest-environment jsdom
/**
 * Form-control contracts: the shared recessed-glass field, the selectable
 * chip, and the sliding segmented control.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Field, Input, Label, Select, Textarea } from "../src/components/ui/Field";
import { Chip } from "../src/components/ui/Chip";
import { SegmentedControl } from "../src/components/ui/SegmentedControl";
import { inputCls } from "../src/lib/fieldCls";
import { calcFraction, classes } from "./helpers/render";

describe("inputCls", () => {
  const cls = new Set(inputCls.split(/\s+/).filter(Boolean));

  it("is built on the recessed field variant of the glass recipe", () => {
    expect(cls.has("lq")).toBe(true);
    expect(cls.has("lq-field")).toBe(true);
  });

  it("fills its container", () => {
    expect(cls.has("w-full")).toBe(true);
  });

  it("sets a dark colour-scheme so native date pickers are not black-on-black", () => {
    expect(cls.has("[color-scheme:dark]")).toBe(true);
  });

  it("removes the default focus outline (the rim takes over)", () => {
    expect(cls.has("focus:outline-none")).toBe(true);
  });

  it("styles the placeholder", () => {
    expect(cls.has("placeholder:text-fg-subtle")).toBe(true);
  });

  it("carries no background utility that would fight --lq-bg", () => {
    expect([...cls].some((c) => /^bg-/.test(c))).toBe(false);
  });

  it("carries no legacy border utility from the pre-glass design", () => {
    expect([...cls].some((c) => /^border(-|$)/.test(c))).toBe(false);
  });
});

describe("Input", () => {
  it("renders an input carrying the shared field class", () => {
    render(<Input aria-label="Title" />);
    const el = screen.getByLabelText("Title");
    expect(el.tagName).toBe("INPUT");
    expect(classes(el).has("lq-field")).toBe(true);
  });

  it("accepts a value and reports changes", () => {
    const onChange = vi.fn();
    render(<Input aria-label="Title" value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Passport" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("forwards the input type", () => {
    render(<Input aria-label="When" type="date" />);
    expect(screen.getByLabelText("When")).toHaveAttribute("type", "date");
  });

  it("merges an extra className", () => {
    render(<Input aria-label="Title" className="pl-10" />);
    const cls = classes(screen.getByLabelText("Title"));
    expect(cls.has("pl-10")).toBe(true);
    expect(cls.has("lq-field")).toBe(true);
  });

  it("supports being disabled", () => {
    render(<Input aria-label="Title" disabled />);
    expect(screen.getByLabelText("Title")).toBeDisabled();
  });
});

describe("Textarea", () => {
  it("renders a textarea that cannot be hand-resized out of the layout", () => {
    render(<Textarea aria-label="Notes" />);
    const el = screen.getByLabelText("Notes");
    expect(el.tagName).toBe("TEXTAREA");
    expect(classes(el).has("resize-none")).toBe(true);
  });

  it("uses the shared field styling", () => {
    render(<Textarea aria-label="Notes" />);
    expect(classes(screen.getByLabelText("Notes")).has("lq-field")).toBe(true);
  });

  it("forwards rows", () => {
    render(<Textarea aria-label="Notes" rows={5} />);
    expect(screen.getByLabelText("Notes")).toHaveAttribute("rows", "5");
  });
});

describe("Select", () => {
  it("renders a select with its options", () => {
    render(
      <Select aria-label="Assign to">
        <option value="">Anyone</option>
        <option value="a">Ravi</option>
      </Select>,
    );
    expect(screen.getByRole("option", { name: "Ravi" })).toBeInTheDocument();
  });

  it("uses the shared field styling", () => {
    render(<Select aria-label="Assign to" />);
    expect(classes(screen.getByLabelText("Assign to")).has("lq-field")).toBe(true);
  });

  it("reports selection changes", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Assign to" value="" onChange={onChange}>
        <option value="">Anyone</option>
        <option value="a">Ravi</option>
      </Select>,
    );
    fireEvent.change(screen.getByLabelText("Assign to"), { target: { value: "a" } });
    expect(onChange).toHaveBeenCalled();
  });
});

describe("Label", () => {
  it("renders its text", () => {
    render(<Label>Expiry date</Label>);
    expect(screen.getByText("Expiry date")).toBeInTheDocument();
  });

  it("marks required fields with an asterisk", () => {
    const { container } = render(<Label required>Title</Label>);
    expect(container.textContent).toContain("*");
  });

  it("omits the asterisk when not required", () => {
    const { container } = render(<Label>Title</Label>);
    expect(container.textContent).not.toContain("*");
  });
});

describe("Field", () => {
  it("associates its label with the control", () => {
    render(
      <Field label="Title">
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("renders an error message when given one", () => {
    render(
      <Field label="Title" error="Title is required">
        <Input />
      </Field>,
    );
    expect(screen.getByText("Title is required")).toBeInTheDocument();
  });

  it("renders no error element when there is no error", () => {
    const { container } = render(
      <Field label="Title">
        <Input />
      </Field>,
    );
    expect(container.querySelector("p")).toBeNull();
  });

  it("renders without a label", () => {
    render(
      <Field>
        <Input aria-label="Bare" />
      </Field>,
    );
    expect(screen.getByLabelText("Bare")).toBeInTheDocument();
  });

  it("passes required through to the label", () => {
    const { container } = render(
      <Field label="Title" required>
        <Input />
      </Field>,
    );
    expect(container.textContent).toContain("*");
  });
});

describe("Chip", () => {
  it("renders as a button with its label", () => {
    render(<Chip>Insurance</Chip>);
    expect(screen.getByRole("button", { name: "Insurance" })).toBeInTheDocument();
  });

  it("defaults to type=button so it never submits a surrounding form", () => {
    render(<Chip>Insurance</Chip>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });

  it("reports its selected state to assistive tech", () => {
    render(<Chip selected>Insurance</Chip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("reports the unselected state too", () => {
    render(<Chip>Insurance</Chip>);
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("fills with the primary liquid when selected", () => {
    render(<Chip selected>x</Chip>);
    expect(classes(screen.getByRole("button")).has("lq-primary")).toBe(true);
  });

  it("stays clear glass when unselected", () => {
    render(<Chip>x</Chip>);
    const cls = classes(screen.getByRole("button"));
    expect(cls.has("lq-primary")).toBe(false);
    expect(cls.has("lq")).toBe(true);
  });

  it("fires onClick", () => {
    const onClick = vi.fn();
    render(<Chip onClick={onClick}>x</Chip>);
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is a pill", () => {
    render(<Chip>x</Chip>);
    expect(classes(screen.getByRole("button")).has("rounded-full")).toBe(true);
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: "todo", label: "To do" },
    { value: "due", label: "Due soon" },
    { value: "done", label: "Completed" },
  ];

  function setup(value = "todo", onChange = vi.fn()) {
    const utils = render(
      <SegmentedControl
        label="Task view"
        options={options}
        value={value}
        onChange={onChange}
      />,
    );
    return { ...utils, onChange };
  }

  it("exposes a labelled tablist", () => {
    setup();
    expect(screen.getByRole("tablist", { name: "Task view" })).toBeInTheDocument();
  });

  it("renders one tab per option", () => {
    setup();
    expect(screen.getAllByRole("tab")).toHaveLength(options.length);
  });

  it("marks exactly one tab selected", () => {
    setup("due");
    const selected = screen
      .getAllByRole("tab")
      .filter((t) => t.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveTextContent("Due soon");
  });

  it("calls onChange with the clicked value", () => {
    const { onChange } = setup("todo");
    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(onChange).toHaveBeenCalledWith("done");
  });

  it("does not call onChange during render", () => {
    const { onChange } = setup();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("every tab is a type=button so it cannot submit a form", () => {
    setup();
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).toHaveAttribute("type", "button");
    }
  });

  it("slides a single pill rather than highlighting each segment", () => {
    const { container } = setup("todo");
    const pills = container.querySelectorAll("span.lq-primary");
    expect(pills).toHaveLength(1);
  });

  it("positions the pill over the first segment", () => {
    const { container } = setup("todo");
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).toBeCloseTo(0, 5);
  });

  it("positions the pill over the last segment", () => {
    const { container } = setup("done");
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).toBeCloseTo(2 / 3, 5);
  });

  it("slides the pill monotonically as the selection moves right", () => {
    const lefts = options.map((o) => {
      const { container, unmount } = setup(o.value);
      const pill = container.querySelector("span.lq-primary") as HTMLElement;
      const left = calcFraction(pill.style.left);
      unmount();
      return left;
    });
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    expect(new Set(lefts).size).toBe(options.length);
  });

  it("sizes the pill to exactly one segment", () => {
    const { container } = setup();
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.width)).toBeCloseTo(1 / 3, 5);
  });

  it("keeps the pill width constant as the selection changes", () => {
    const widths = options.map((o) => {
      const { container, unmount } = setup(o.value);
      const pill = container.querySelector("span.lq-primary") as HTMLElement;
      const w = calcFraction(pill.style.width);
      unmount();
      return w;
    });
    expect(new Set(widths).size).toBe(1);
  });

  it("falls back to the first segment for an unknown value", () => {
    const { container } = render(
      <SegmentedControl options={options} value="nope" onChange={vi.fn()} />,
    );
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).toBeCloseTo(0, 5);
  });

  it("hides the decorative pill from assistive tech", () => {
    const { container } = setup();
    expect(container.querySelector("span.lq-primary")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("keeps the pill absolutely positioned (the .lq recipe must not force relative)", () => {
    const { container } = setup();
    const pill = container.querySelector("span.lq-primary")!;
    expect(classes(pill).has("absolute")).toBe(true);
  });

  it("works with a two-option control", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SegmentedControl
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        value="b"
        onChange={onChange}
      />,
    );
    const pill = container.querySelector("span.lq-primary") as HTMLElement;
    expect(calcFraction(pill.style.left)).toBeCloseTo(1 / 2, 5);
    expect(calcFraction(pill.style.width)).toBeCloseTo(1 / 2, 5);
    fireEvent.click(screen.getByRole("tab", { name: "A" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });
});
