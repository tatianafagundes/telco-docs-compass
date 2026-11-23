// EDS table styles: numbers right-aligned with tabular figures; the whole sortable header is the target.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable } from "@/components/erad/data-table";
import { Pagination } from "@/components/erad/pagination";
describe("DataTable (EDS)", () => {
  it("right-aligns numeric columns and makes the whole header sort", () => {
    const onSort = vi.fn();
    render(
      <DataTable
        caption="Policies"
        rowId={(r: { id: string; n: number }) => r.id}
        rows={[{ id: "a", n: 12 }]}
        sort={{ key: "n", dir: "asc" }}
        onSort={onSort}
        columns={[
          { key: "id", header: "Policy", cell: (r) => r.id },
          { key: "n", header: "Documents", numeric: true, sortable: true, cell: (r) => r.n },
        ]}
      />,
    );
    const header = screen.getByRole("columnheader", { name: /Documents/ });
    expect(header.className).toContain("text-right");
    expect(screen.getByText("12").className).toContain("tabular-nums");
    const button = screen.getByRole("button", { name: /Documents/ });
    expect(button.className).toContain("w-full");
    fireEvent.click(button);
    expect(onSort).toHaveBeenCalledWith("n");
  });
});
describe("Pagination (EDS)", () => {
  it("shows the range, marks the current page and pages forward", () => {
    const onPage = vi.fn();
    render(<Pagination page={0} pageSize={25} total={60} onPage={onPage} label="documents" />);
    expect(screen.getByText("1–25 of 60")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 1" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      screen.getByRole("button", { name: "Previous page" }).getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPage).toHaveBeenCalledWith(1);
  });
  it("is not shown when everything fits on one page", () => {
    const { container } = render(
      <Pagination page={0} pageSize={25} total={10} onPage={() => undefined} label="documents" />,
    );
    expect(container.innerHTML).toBe("");
  });
});
