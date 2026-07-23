import { useEffect, useRef, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import type { AlbumNavigationYear } from "@album/shared";
import { formatCapturedAt } from "../../lib/capturedAtFormat.js";
import { trapTab } from "../../lib/focusTrap.js";

export type JumpState =
  | { status: "idle" }
  | { status: "pending"; anchor: string }
  | { status: "empty_period"; anchor: string }
  | { status: "failed"; anchor: string };

interface DateNavigationProps {
  years: AlbumNavigationYear[];
  jumpState: JumpState;
  onJump: (anchor: string) => void;
  /** Aborts the in-flight candidate and returns to idle -- Escape, backdrop, and Close all route through this. */
  onCancelJump: () => void;
  /** Called once the sheet closes itself after a successful commit, so the caller can focus the destination heading. */
  onJumpCommitted: () => void;
  /** The topmost visible period; changes its active styling only, never the disclosure state (design doc "Date Navigation and History"). */
  visiblePeriodKey?: string;
}

/** Desktop year index plus a mobile "Jump to date" bottom sheet, sharing one year/month hierarchy. */
export function DateNavigation({ years, jumpState, onJump, onCancelJump, onJumpCommitted, visiblePeriodKey }: DateNavigationProps) {
  const [expandedYear, setExpandedYear] = useState<number>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousJumpStatusRef = useRef(jumpState.status);

  // Retains the sheet while a candidate loads; closes it -- and hands focus to the destination
  // collection heading -- only once that candidate actually commits (design doc "Date Navigation
  // and History"). Empty-period and failed outcomes leave the sheet open so their status can be
  // shown and announced in place.
  useEffect(() => {
    if (sheetOpen && previousJumpStatusRef.current === "pending" && jumpState.status === "idle") {
      setSheetOpen(false);
      onJumpCommitted();
    }
    previousJumpStatusRef.current = jumpState.status;
  }, [jumpState.status, sheetOpen, onJumpCommitted]);

  useEffect(() => {
    if (sheetOpen) {
      headingRef.current?.focus();
    }
  }, [sheetOpen]);

  const cancelAndClose = (): void => {
    setSheetOpen(false);
    onCancelJump();
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!sheetOpen) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAndClose();
      } else if (event.key === "Tab") {
        trapTab(event, dialogRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetOpen]);

  return (
    <>
      <nav
        aria-label="Jump to date"
        className="hidden w-56 shrink-0 md:sticky md:top-[var(--album-bar-height)] md:block md:max-h-[calc(100vh_-_var(--album-bar-height))] md:overflow-y-auto"
      >
        <YearList
          expandedYear={expandedYear}
          jumpState={jumpState}
          onJump={onJump}
          onToggleYear={(year) => setExpandedYear((current) => (current === year ? undefined : year))}
          {...(visiblePeriodKey !== undefined ? { visiblePeriodKey } : {})}
          years={years}
        />
        <JumpStatus jumpState={jumpState} onRetry={onJump} />
      </nav>

      <div className="md:hidden">
        <button
          className="inline-flex min-h-10 items-center rounded-md border border-control-line bg-print-white px-3 text-sm font-semibold text-ink"
          onClick={() => setSheetOpen(true)}
          ref={triggerRef}
          type="button"
        >
          Jump to date
        </button>
        {sheetOpen ? (
          <div
            aria-label="Jump to date"
            aria-modal="true"
            className="fixed inset-0 z-30 flex items-end bg-ink/40"
            onClick={cancelAndClose}
            role="dialog"
          >
            <div
              className="max-h-[70vh] w-full overflow-y-auto rounded-t-xl bg-print-white p-4"
              onClick={(event) => event.stopPropagation()}
              ref={dialogRef}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-ink" ref={headingRef} tabIndex={-1}>
                  Jump to date
                </h2>
                <button aria-label="Close" onClick={cancelAndClose} type="button">
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <YearList
                expandedYear={expandedYear}
                jumpState={jumpState}
                onJump={onJump}
                onToggleYear={(year) => setExpandedYear((current) => (current === year ? undefined : year))}
                showLatestInYear
                years={years}
              />
              <JumpStatus jumpState={jumpState} onRetry={onJump} />
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

function JumpStatus({ jumpState, onRetry }: { jumpState: JumpState; onRetry: (anchor: string) => void }) {
  if (jumpState.status === "pending") {
    return (
      <p className="mt-3 text-sm text-ink-muted" role="status">
        Loading that period…
      </p>
    );
  }
  if (jumpState.status === "empty_period") {
    return (
      <p className="mt-3 rounded-md border-l-2 border-exposure bg-exposure/10 px-3 py-2 text-sm font-semibold text-ink" role="status">
        That period is now empty.
      </p>
    );
  }
  if (jumpState.status === "failed") {
    return (
      <p className="mt-3 flex items-center gap-2 rounded-md border-l-2 border-danger bg-danger/10 px-3 py-2 text-sm font-semibold text-danger" role="alert">
        Couldn&apos;t jump to that date.
        <button className="underline" onClick={() => onRetry(jumpState.anchor)} type="button">
          Retry
        </button>
      </p>
    );
  }
  return null;
}

function YearList({
  expandedYear,
  jumpState,
  onJump,
  onToggleYear,
  showLatestInYear = false,
  visiblePeriodKey,
  years,
}: {
  expandedYear: number | undefined;
  jumpState: JumpState;
  onJump: (anchor: string) => void;
  onToggleYear: (year: number) => void;
  showLatestInYear?: boolean;
  visiblePeriodKey?: string;
  years: AlbumNavigationYear[];
}) {
  if (years.length === 0) {
    return null;
  }

  const visibleYear = visiblePeriodKey?.split("-")[0];

  return (
    <ul className="space-y-1">
      {years.map((year) => {
        const expanded = expandedYear === year.year;
        const isVisibleYear = visibleYear === String(year.year);
        const periods = orderedPeriods(year);
        const latest = periods[0];
        return (
          <li key={year.year}>
            <div className="flex items-center gap-0.5">
              {/* Jump (year numeral) and disclosure (caret) are two independent controls -- clicking
                  the year always jumps to its newest month, the caret only ever toggles the list
                  (design doc "Year jumping and disclosure are separate controls"). */}
              <button
                aria-current={isVisibleYear ? "true" : undefined}
                className={`flex min-h-11 flex-1 items-center rounded px-1 text-left font-display text-2xl font-semibold tracking-tight transition-colors hover:bg-ink/5 ${
                  isVisibleYear ? "text-exposure" : "text-ink"
                }`}
                onClick={() => latest && onJump(latest.anchor)}
                type="button"
              >
                {year.year}
              </button>
              <button
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${year.year}`}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-ink/5"
                onClick={() => onToggleYear(year.year)}
                type="button"
              >
                <ChevronDown
                  aria-hidden="true"
                  className={`h-4 w-4 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
                />
              </button>
            </div>
            {expanded ? (
              <ul className="ml-2 space-y-0.5 border-l border-line py-1 pl-3">
                {showLatestInYear && latest ? (
                  <li>
                    <PeriodButton anchor={latest.anchor} jumpState={jumpState} label={`Latest in ${year.year}`} onJump={onJump} />
                  </li>
                ) : null}
                {periods.map((period) => (
                  <li key={period.anchor}>
                    <PeriodButton
                      anchor={period.anchor}
                      count={period.count}
                      displayLabel={period.shortLabel}
                      isVisible={period.anchor === visiblePeriodKey}
                      jumpState={jumpState}
                      label={period.label}
                      onJump={onJump}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PeriodButton({
  anchor,
  count,
  displayLabel,
  isVisible = false,
  jumpState,
  label,
  onJump,
}: {
  anchor: string;
  count?: number;
  /** The compact mono label shown visually (e.g. "JUL"); falls back to `label` when absent (e.g. "Latest in 2024"). */
  displayLabel?: string;
  isVisible?: boolean;
  jumpState: JumpState;
  label: string;
  onJump: (anchor: string) => void;
}) {
  const isPending = jumpState.status === "pending" && jumpState.anchor === anchor;
  return (
    <button
      aria-current={isVisible ? "true" : undefined}
      aria-label={count !== undefined ? `${label}, ${count} photos` : label}
      className={`flex min-h-8 w-full items-center justify-between rounded px-2 text-left hover:bg-ink/5 disabled:text-ink-muted/50 ${
        isVisible ? "font-semibold text-exposure" : "text-ink-muted"
      }`}
      disabled={isPending}
      onClick={() => onJump(anchor)}
      type="button"
    >
      {/* Mono/uppercase data typography is reserved for the genuine month abbreviation; the plain
          "Latest in {year}" action reads as an ordinary instruction (design doc "Typography"). */}
      <span aria-hidden="true" className={displayLabel !== undefined ? "font-mono text-xs uppercase tracking-wider" : "text-sm"}>
        {displayLabel ?? label}
      </span>
      {count !== undefined ? (
        <span aria-hidden="true" className="font-mono text-[0.7rem] text-ink-muted">
          {count}
        </span>
      ) : null}
    </button>
  );
}

interface OrderedPeriod {
  anchor: string;
  label: string;
  /** Mono abbreviation for the indented month list, e.g. "JUL"; "Unknown" for the Date Unknown row. */
  shortLabel: string;
  count: number;
}

const MONTH_ABBREVIATIONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Newest month first, then Date Unknown, per the design doc's year-row ordering. */
const orderedPeriods = (year: AlbumNavigationYear): OrderedPeriod[] => {
  const monthEntries = Object.entries(year.counts)
    .filter(([key]) => key !== "unknown")
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([month, count]) => ({
      anchor: `${year.year}-${month}`,
      label: formatCapturedAt({ precision: "month", localDate: `${year.year}-${month}` }, "accessible"),
      shortLabel: MONTH_ABBREVIATIONS[Number(month) - 1] ?? month,
      count,
    }));
  const unknownCount = year.counts.unknown;
  return unknownCount !== undefined
    ? [
        ...monthEntries,
        { anchor: `${year.year}-unknown`, label: "Date unknown", shortLabel: "Unknown", count: unknownCount },
      ]
    : monthEntries;
};
