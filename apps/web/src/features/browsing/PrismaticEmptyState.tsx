import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

interface PrismaticEmptyStateProps {
  action?: ReactNode;
  description: string;
  title: string;
  variant: "album" | "archive";
}

/** The Light Field's only expressive composition; its planes are purely decorative. */
export function PrismaticEmptyState({ action, description, title, variant }: PrismaticEmptyStateProps) {
  const stageRef = useRef<HTMLElement>(null);
  const pausedByInteractionRef = useRef(false);

  useEffect(() => {
    if (variant !== "album") return;
    const stage = stageRef.current;
    if (!stage) return;
    const syncVisibility = () => stage.classList.toggle("prismatic-empty--ambient-paused", pausedByInteractionRef.current || document.visibilityState !== "visible");
    const pauseForInteraction = () => { pausedByInteractionRef.current = true; syncVisibility(); };
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    stage.addEventListener("pointerdown", pauseForInteraction, { once: true });
    stage.addEventListener("keydown", pauseForInteraction, { once: true });
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
      stage.removeEventListener("pointerdown", pauseForInteraction);
      stage.removeEventListener("keydown", pauseForInteraction);
    };
  }, [variant]);

  return (
    <section className={`prismatic-empty prismatic-empty--${variant}`} ref={stageRef}>
      <div className="prismatic-empty__copy">
        <p className="prismatic-empty__eyebrow">Your Personal Album</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {action ? <div className="prismatic-empty__action">{action}</div> : null}
      </div>
      {variant === "album" ? <div aria-hidden="true" className="prismatic-empty__planes"><span className="prismatic-plane prismatic-plane--one" /><span className="prismatic-plane prismatic-plane--two" /><span className="prismatic-plane prismatic-plane--three" /></div> : null}
    </section>
  );
}
