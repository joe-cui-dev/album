import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import type { ListCollectionPhotosResponse, PhotoCollection } from "@album/shared";
import type { AlbumMutations } from "../album/albumMutations.js";
import { useAlbumMutationsSnapshot } from "../album/useAlbumMutations.js";
import { createHttpAlbumBrowsingPort } from "./httpAlbumBrowsingPort.js";
import { BrowsingGrid } from "./BrowsingGrid.js";
import { BROWSING_ROW_SPACING, BROWSING_TARGET_ROW_HEIGHT } from "./browsingLayoutConstants.js";
import type { BrowsingHistoryRegistry } from "./browsingHistoryRegistry.js";
import { createBrowsingWindow, type BrowsingWindow } from "./browsingWindow.js";
import { DateNavigation, type JumpState } from "./DateNavigation.js";
import { probeDateJump } from "./dateJump.js";
import { useAlbumNavigation } from "./useAlbumNavigation.js";

interface BrowsingPageProps {
  collection: PhotoCollection;
  registry: BrowsingHistoryRegistry;
  mutations: AlbumMutations;
  title: string;
  emptyState: { title: string; description: string; action?: ReactNode };
}

/** Assembles one history entry's Browsing Window with Album Navigation and manual date Jump (implementation doc "Date Navigation and History"). */
export function BrowsingPage({ collection, registry, mutations, title, emptyState }: BrowsingPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const startAt = searchParams.get("startAt") ?? undefined;
  const key = `${collection}:${startAt ?? "latest"}`;

  // Set by a committed date Jump just before its URL update re-renders this component with a new `key`,
  // so the freshly probed page seeds the window instead of being fetched a second time.
  const pendingJumpPageRef = useRef<{ anchor: string; page: ListCollectionPhotosResponse } | undefined>(undefined);

  const windowRef = useRef<{ key: string; window: BrowsingWindow } | undefined>(undefined);
  if (!windowRef.current || windowRef.current.key !== key) {
    const seededPage =
      startAt !== undefined && pendingJumpPageRef.current?.anchor === startAt
        ? pendingJumpPageRef.current.page
        : undefined;
    pendingJumpPageRef.current = undefined;
    windowRef.current = {
      key,
      window: registry.activate(key, () =>
        createBrowsingWindow({
          collection,
          ...(startAt !== undefined ? { startAt } : {}),
          ...(seededPage !== undefined ? { initialPage: seededPage } : {}),
          port: createHttpAlbumBrowsingPort(),
          layout: {
            containerWidth: typeof window !== "undefined" ? window.innerWidth : 1024,
            spacing: BROWSING_ROW_SPACING,
            targetRowHeight: BROWSING_TARGET_ROW_HEIGHT,
          },
        }),
      ),
    };
  }
  const browsingWindow = windowRef.current.window;

  const mutationsSnapshot = useAlbumMutationsSnapshot(mutations);
  const navigation = useAlbumNavigation(mutationsSnapshot.navigationRevision);
  const years = (collection === "active" ? navigation.data?.timeline.years : navigation.data?.archive.years) ?? [];

  // Exact Photo counts for the month marker's second line, keyed the same way as `periodKey`
  // ("YYYY-MM" or "YYYY-unknown") -- see `browsingWindow.ts`'s `periodKeyOf`.
  const periodCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const year of years) {
      for (const [month, count] of Object.entries(year.counts)) {
        map.set(month === "unknown" ? `${year.year}-unknown` : `${year.year}-${month}`, count);
      }
    }
    return map;
  }, [years]);

  const [jumpState, setJumpState] = useState<JumpState>({ status: "idle" });
  const jumpControllerRef = useRef<AbortController | undefined>(undefined);
  const jumpPortRef = useRef(createHttpAlbumBrowsingPort());

  const onJump = async (anchor: string): Promise<void> => {
    jumpControllerRef.current?.abort();
    const controller = new AbortController();
    jumpControllerRef.current = controller;
    setJumpState({ status: "pending", anchor });

    const result = await probeDateJump({
      collection,
      targetAnchor: anchor,
      port: jumpPortRef.current,
      signal: controller.signal,
    });
    if (controller.signal.aborted) {
      return;
    }
    if (result.outcome === "committed") {
      setJumpState({ status: "idle" });
      pendingJumpPageRef.current = { anchor, page: result.page };
      setSearchParams({ startAt: anchor });
    } else if (result.outcome === "empty_period") {
      setJumpState({ status: "empty_period", anchor });
      navigation.refresh();
    } else if (result.outcome === "failed") {
      setJumpState({ status: "failed", anchor });
    }
  };

  // Closing the mobile sheet (Escape/backdrop/Close) cancels whatever candidate is in flight
  // and returns to idle without committing a URL/history entry (ADR-0058).
  const onCancelJump = (): void => {
    jumpControllerRef.current?.abort();
    setJumpState({ status: "idle" });
  };

  const photoHrefFor = (photoId: string): string => `/album/photos/${photoId}`;
  const [visiblePeriodKey, setVisiblePeriodKey] = useState<string>();

  const location = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The Viewer's standalone Close navigates here and asks for the main heading to be focused (implementation doc "Direct route").
    if ((location.state as { focusMainHeading?: boolean } | null)?.focusMainHeading) {
      headingRef.current?.focus();
    }
    // Only the state present at the moment this page was navigated to matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="album-content flex flex-col gap-4 py-4 md:flex-row md:gap-6 md:py-6">
      <DateNavigation
        jumpState={jumpState}
        onCancelJump={onCancelJump}
        onJump={(anchor) => void onJump(anchor)}
        onJumpCommitted={() => headingRef.current?.focus()}
        {...(visiblePeriodKey !== undefined ? { visiblePeriodKey } : {})}
        years={years}
      />
      <div className="min-w-0 w-full flex-1">
        <h1 className="mb-4" ref={headingRef} tabIndex={-1}>
          {title}
        </h1>
        <BrowsingGrid
          browsingWindow={browsingWindow}
          emptyState={emptyState}
          onVisiblePeriodChange={setVisiblePeriodKey}
          periodCounts={periodCounts}
          photoHrefFor={photoHrefFor}
          sourceCollection={collection}
        />
      </div>
    </main>
  );
}
