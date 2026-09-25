"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_REFRESH_MS = 3500;
const STICK_TO_BOTTOM_DISTANCE_PX = 140;

export function OpsLiveRefresh({
  intervalMs = DEFAULT_REFRESH_MS,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const timer = window.setInterval(refresh, intervalMs);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [intervalMs, router]);

  return null;
}

export function ChatTimeline({
  conversationKey,
  lastEventKey,
  children,
}: {
  conversationKey: string;
  lastEventKey: string;
  children: ReactNode;
}) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const shouldStickToBottom = useRef(true);
  const previousConversation = useRef(conversationKey);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const conversationChanged =
      previousConversation.current !== conversationKey;
    previousConversation.current = conversationKey;

    if (conversationChanged) {
      shouldStickToBottom.current = true;
    }

    if (!shouldStickToBottom.current) return;

    const frame = window.requestAnimationFrame(() => {
      timeline.scrollTop = timeline.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [conversationKey, lastEventKey]);

  function handleScroll() {
    const timeline = timelineRef.current;
    if (!timeline) return;

    const distanceFromBottom =
      timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
    shouldStickToBottom.current =
      distanceFromBottom <= STICK_TO_BOTTOM_DISTANCE_PX;
  }

  return (
    <div
      aria-live="polite"
      className="waTimeline"
      onScroll={handleScroll}
      ref={timelineRef}
    >
      {children}
      <div aria-hidden="true" className="waBottomAnchor" />
    </div>
  );
}
