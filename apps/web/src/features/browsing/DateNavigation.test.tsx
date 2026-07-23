import { act, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AlbumNavigationYear } from "@album/shared";
import { renderApp } from "../../test/test-utils.js";
import { DateNavigation, type JumpState } from "./DateNavigation.js";

const years: AlbumNavigationYear[] = [{ year: 2024, counts: { "07": 3, unknown: 1 } }];

let externalSetJumpState: ((state: JumpState) => void) | undefined;

/** Wires DateNavigation the way BrowsingPage does, so tests can drive `jumpState` transitions. */
function Harness({ onJump, onCommitted }: { onJump: (anchor: string) => void; onCommitted: () => void }) {
  const [jumpState, setJumpState] = useState<JumpState>({ status: "idle" });
  externalSetJumpState = setJumpState;
  return (
    <DateNavigation
      jumpState={jumpState}
      onCancelJump={() => setJumpState({ status: "idle" })}
      onJump={(anchor) => {
        setJumpState({ status: "pending", anchor });
        onJump(anchor);
      }}
      onJumpCommitted={onCommitted}
      years={years}
    />
  );
}

const openMobileSheet = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: "Jump to date" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Jump to date" })).toHaveFocus());
};

describe("DateNavigation mobile sheet", () => {
  it("is a true modal, and focuses its heading on open", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onCommitted={vi.fn()} onJump={vi.fn()} />);

    await openMobileSheet(user);

    expect(screen.getByRole("dialog", { name: "Jump to date" })).toHaveAttribute("aria-modal", "true");
  });

  it("Escape cancels the candidate and restores focus to the trigger", async () => {
    const user = userEvent.setup();
    const onJump = vi.fn();
    renderApp(<Harness onCommitted={vi.fn()} onJump={onJump} />);
    await openMobileSheet(user);

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Jump to date" })).toHaveFocus());
  });

  it("backdrop click cancels and closes, but clicking inside the sheet does not", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onCommitted={vi.fn()} onJump={vi.fn()} />);
    await openMobileSheet(user);

    await user.click(screen.getByRole("heading", { name: "Jump to date" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("dialog"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Close button cancels the candidate and closes the sheet", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onCommitted={vi.fn()} onJump={vi.fn()} />);
    await openMobileSheet(user);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("retains the sheet and shows a pending status while a candidate loads", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onCommitted={vi.fn()} onJump={vi.fn()} />);
    await openMobileSheet(user);

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "2024" }));

    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("Loading that period…");
  });

  it("closes only after a successful commit, and hands focus to the destination heading", async () => {
    const user = userEvent.setup();
    const onCommitted = vi.fn();
    renderApp(<Harness onCommitted={onCommitted} onJump={vi.fn()} />);
    await openMobileSheet(user);

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "2024" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    act(() => externalSetJumpState?.({ status: "idle" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("shows a retryable failure status inside the sheet without closing it", async () => {
    const user = userEvent.setup();
    renderApp(<Harness onCommitted={vi.fn()} onJump={vi.fn()} />);
    await openMobileSheet(user);

    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "2024" }));
    act(() => externalSetJumpState?.({ status: "failed", anchor: "2024-07" }));

    expect(within(screen.getByRole("dialog")).getByRole("alert")).toHaveTextContent("Couldn't jump to that date.");
  });
});
