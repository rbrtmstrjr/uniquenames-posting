// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { NameRow } from "@/lib/db/types";
import { polyfillRadix } from "./helpers/radix-jsdom";

vi.mock("@/lib/actions/names", () => ({ addNamesAction: vi.fn(), updateNameAction: vi.fn(), setSkipAction: vi.fn(), deleteNameAction: vi.fn() }));
vi.mock("@/lib/actions/call", () => ({ callAction: vi.fn(async () => ({ ok: true })), optimistic: vi.fn(async () => ({ ok: true })) }));
const { NamesTable } = await import("@/components/names/names-table");

beforeAll(polyfillRadix);
afterEach(cleanup);

const now = "2026-10-05T00:00:00Z";
const row = (name: string, status: NameRow["status"]): NameRow =>
  ({ id: name, name, meaning: "a meaning", gender: "boy", style: "single", status, post_id: null, position: null, created_at: now, updated_at: now });

describe("Names page: pending filter", () => {
  it("hides the Pending filter while nothing is pending", () => {
    render(<NamesTable names={[row("Aaron", "available")]} />);
    expect(screen.queryByRole("radio", { name: "Pending" })).toBeNull();
    expect(screen.getByRole("radio", { name: "Available" })).toBeTruthy();
  });

  it("shows Pending with its count, lists only pending names, and keeps them out of Available", () => {
    render(<NamesTable names={[row("Aaron", "available"), row("Zephyr", "pending"), row("Orion", "pending")]} />);
    expect(screen.getByText("Aaron")).toBeTruthy();
    expect(screen.queryByText("Zephyr")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Pending · 2" }));
    expect(screen.getByText("Zephyr")).toBeTruthy();
    expect(screen.getByText("Orion")).toBeTruthy();
    expect(screen.queryByText("Aaron")).toBeNull();
    // a pending name can be edited or removed, but not skipped
    expect(screen.getByRole("button", { name: "Delete Zephyr" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Zephyr" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skip Zephyr" })).toBeNull();
  });
});
