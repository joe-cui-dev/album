import { useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import type { AlbumNavigationYear } from "@album/shared";
import { formatCapturedAt } from "../../lib/capturedAtFormat.js";

export type JumpState =
  | { status: "idle" }
  | { status: "pending"; anchor: string }
  | { status: "empty_period"; anchor: string }
  | { status: "failed"; anchor: string };

interface DateNavigationProps {
  years: AlbumNavigationYear[];
  jumpState: JumpState;
  onJump: (anchor: string) => void;
  /** The topmost visible period; changes its active styling only, never the disclosure state (design doc "Date Navigation and History"). */
  visiblePeriodKey?: string;
}

/** Desktop year index plus a mobile "Jump to date" bottom sheet, sharing one year/month hierarchy. */
export function DateNavigation({ years, jumpState, onJump, visiblePeriodKey }: DateNavigationProps) {
  const [expandedYear, setExpandedYear] = useState<number>();
  const [sheetOpen, setSheetOpen] = useState(false);

  const closeAndJump = (anchor: string) => {
    setSheetOpen(false);
    onJump(anchor);
  };

  return (
    <>
      <nav aria-label="Jump to date" className="hidden w-56 shrink-0 md:block">
        <YearList
          expandedYear={expandedYear}
          jumpState={jumpState}
          onJump={onJump}
          onToggleYear={(year) => setExpandedYear((current) => (current === year ? undefined : year))}
          {...(visiblePeriodKey !== undefined ? { visiblePeriodKey } : {})}
          years={years}
        />
      </nav>

      <div className="md:hidden">
        <button
          className="inline-flex min-h-10 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-900"
          onClick={() => setSheetOpen(true)}
          type="button"
        >
          Jump to date
        </button>
        {sheetOpen ? (
          <div
            aria-label="Jump to date"
            aria-modal="true"
            className="fixed inset-0 z-30 flex items-end bg-stone-950/40"
            onClick={() => setSheetOpen(false)}
            role="dialog"
          >
            <div
              className="max-h-[70vh] w-full overflow-y-auto rounded-t-xl bg-white p-4"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-stone-950">Jump to date</h2>
                <button aria-label="Close" onClick={() => setSheetOpen(false)} type="button">
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <YearList
                expandedYear={expandedYear}
                jumpState={jumpState}
                onJump={closeAndJump}
                onToggleYear={(year) => setExpandedYear((current) => (current === year ? undefined : year))}
                showLatestInYear
                years={years}
              />
            </div>
          </div>
        ) : null}
      </div>

      {jumpState.status === "empty_period" ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900" role="status">
          That period is now empty.
        </p>
      ) : null}
      {jumpState.status === "failed" ? (
        <p className="flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
          Couldn&apos;t jump to that date.
          <button className="underline" onClick={() => onJump(jumpState.anchor)} type="button">
            Retry
          </button>
        </p>
      ) : null}
    </>
  );
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
            <div className="flex items-center gap-1">
              <button
                aria-expanded={expanded}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${year.year}`}
                className="flex h-8 w-8 items-center justify-center rounded text-stone-600 hover:bg-stone-100"
                onClick={() => onToggleYear(year.year)}
                type="button"
              >
                {expanded ? (
                  <ChevronDown aria-hidden="true" className="h-4 w-4" />
                ) : (
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                )}
              </button>
              <button
                aria-current={isVisibleYear ? "true" : undefined}
                className={`min-h-8 flex-1 rounded px-2 text-left text-sm font-semibold hover:bg-stone-100 ${
                  isVisibleYear ? "bg-emerald-50 text-emerald-900" : "text-stone-900"
                }`}
                onClick={() => latest && onJump(latest.anchor)}
                type="button"
              >
                {year.year}
              </button>
            </div>
            {expanded ? (
              <ul className="ml-9 space-y-0.5 py-1">
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
  isVisible = false,
  jumpState,
  label,
  onJump,
}: {
  anchor: string;
  count?: number;
  isVisible?: boolean;
  jumpState: JumpState;
  label: string;
  onJump: (anchor: string) => void;
}) {
  const isPending = jumpState.status === "pending" && jumpState.anchor === anchor;
  return (
    <button
      aria-current={isVisible ? "true" : undefined}
      className={`flex min-h-8 w-full items-center justify-between rounded px-2 text-left text-sm hover:bg-stone-100 disabled:text-stone-400 ${
        isVisible ? "bg-emerald-50 font-semibold text-emerald-900" : "text-stone-700"
      }`}
      disabled={isPending}
      onClick={() => onJump(anchor)}
      type="button"
    >
      <span>{label}</span>
      {count !== undefined ? <span className="text-xs text-stone-500">{count}</span> : null}
    </button>
  );
}

interface OrderedPeriod {
  anchor: string;
  label: string;
  count: number;
}

/** Newest month first, then Date Unknown, per the design doc's year-row ordering. */
const orderedPeriods = (year: AlbumNavigationYear): OrderedPeriod[] => {
  const monthEntries = Object.entries(year.counts)
    .filter(([key]) => key !== "unknown")
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([month, count]) => ({
      anchor: `${year.year}-${month}`,
      label: formatCapturedAt({ precision: "month", localDate: `${year.year}-${month}` }, "accessible"),
      count,
    }));
  const unknownCount = year.counts.unknown;
  return unknownCount !== undefined
    ? [...monthEntries, { anchor: `${year.year}-unknown`, label: "Date unknown", count: unknownCount }]
    : monthEntries;
};
