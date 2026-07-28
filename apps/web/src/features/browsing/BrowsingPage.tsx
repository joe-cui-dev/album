import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
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
import { PermanentDeletionDialog } from "../album/PermanentDeletionDialog.js";

interface BrowsingPageProps {
  collection: PhotoCollection;
  registry: BrowsingHistoryRegistry;
  mutations: AlbumMutations;
  title: string;
  emptyState: { title: string; description: string; action?: ReactNode };
}

interface BrowsingRouteState {
  /** An opaque per-history-entry Browsing Window identity (ADR-0053); never derived from the URL. */
  browsingKey?: string;
  background?: unknown;
  focusMainHeading?: boolean;
}

const createBrowsingWindowKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `bw-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Assembles one history entry's Browsing Window with Album Navigation and manual date Jump (implementation doc "Date Navigation and History"). */
export function BrowsingPage({ collection, registry, mutations, title, emptyState }: BrowsingPageProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const startAt = searchParams.get("startAt") ?? undefined;

  const location = useLocation();
  const navigate = useNavigate();
  const routeState = (location.state ?? {}) as BrowsingRouteState;

  // A fresh opaque key per history entry, including two entries sharing the same URL (ADR-0053):
  // recomputed only when the entry itself changes (`location.key`, React Router's own per-entry
  // token used here purely as a change signal, not as the stored identity), not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const browsingKey = useMemo(() => routeState.browsingKey ?? createBrowsingWindowKey(), [location.key]);

  useEffect(() => {
    // Stamps the generated key into this exact history entry's own state (a `replace`, not a new
    // entry) so Back/Forward recovers it verbatim; a direct load or refresh has no prior state and
    // always regenerates one here. `background` (the contextual Viewer's own state) and any other
    // existing fields are preserved, not overwritten.
    if (routeState.browsingKey !== browsingKey) {
      navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true, state: { ...routeState, browsingKey } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browsingKey]);

  // Set by a committed date Jump just before its URL update re-renders this component with a new
  // `browsingKey`, so the freshly probed page seeds the window instead of being fetched a second time.
  const pendingJumpPageRef = useRef<{ anchor: string; page: ListCollectionPhotosResponse } | undefined>(undefined);

  const windowRef = useRef<{ key: string; window: BrowsingWindow } | undefined>(undefined);
  if (!windowRef.current || windowRef.current.key !== browsingKey) {
    const seededPage =
      startAt !== undefined && pendingJumpPageRef.current?.anchor === startAt
        ? pendingJumpPageRef.current.page
        : undefined;
    pendingJumpPageRef.current = undefined;
    windowRef.current = {
      key: browsingKey,
      window: registry.activate(browsingKey, collection, () =>
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
  const observedTrashRevision = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (collection !== "trashed") return;
    if (observedTrashRevision.current === undefined) {
      observedTrashRevision.current = mutationsSnapshot.trashRevision;
      return;
    }
    if (observedTrashRevision.current !== mutationsSnapshot.trashRevision) {
      observedTrashRevision.current = mutationsSnapshot.trashRevision;
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: { ...routeState, browsingKey: createBrowsingWindowKey() } },
      );
    }
  }, [collection, location.hash, location.pathname, location.search, mutationsSnapshot.trashRevision, navigate, routeState]);
  const navigation = useAlbumNavigation(mutationsSnapshot.navigationRevision);
  const years = (collection === "active" ? navigation.data?.timeline.years : navigation.data?.trash.years) ?? [];

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
  const [emptyTrashConfirmationOpen, setEmptyTrashConfirmationOpen] = useState(false);

  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // The Viewer's standalone Close navigates here and asks for the main heading to be focused (implementation doc "Direct route").
    if (routeState.focusMainHeading) {
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
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="flex-1" ref={headingRef} tabIndex={-1}>{title}</h1>
          {collection === "trashed" ? (
            <button className="rounded px-3 py-2 text-sm text-danger hover:bg-danger/10" onClick={() => setEmptyTrashConfirmationOpen(true)} type="button">
              Empty Trash
            </button>
          ) : null}
        </div>
        <BrowsingGrid
          browsingWindow={browsingWindow}
          emptyState={emptyState}
          onVisiblePeriodChange={setVisiblePeriodKey}
          periodCounts={periodCounts}
          photoHrefFor={photoHrefFor}
          sourceCollection={collection}
        />
      </div>
      {emptyTrashConfirmationOpen ? (
        <PermanentDeletionDialog
          onCancel={() => setEmptyTrashConfirmationOpen(false)}
          onConfirm={() => { setEmptyTrashConfirmationOpen(false); mutations.intents.emptyTrash(); }}
          target="trash"
        />
      ) : null}
    </main>
  );
}
