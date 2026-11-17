"use client";

// Quotes with play buttons. A quote is looked up by segment id in the transcript, so the page only
// ever shows words from the recording, never words the model wrote. The page has one <audio>
// element with the uploaded file, and a play button plays just the time range of its segment.

import { createContext, useContext, useRef, useState } from "react";
import { formatTime } from "@/lib/format";
import type { Segment } from "@/lib/transcript";

// Word timestamps mark where words start and end. A small margin keeps the first and last sounds.
const LEAD_IN_SEC = 0.1;
const LEAD_OUT_SEC = 0.25;

// The ref goes on the page's <audio> element.
export function usePlayer() {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<number | null>(null); // segment id
  const frame = useRef(0);

  function stop() {
    cancelAnimationFrame(frame.current);
    audio.current?.pause();
    setPlaying(null);
  }

  // Plays a segment, or stops it if it is the one playing. The end is checked on every frame:
  // the timeupdate event fires only about 4 times a second and would play into the next sentence.
  function toggle(segment: Segment) {
    const el = audio.current;
    if (!el) return;
    if (playing === segment.id) return stop();
    cancelAnimationFrame(frame.current);
    const end = segment.end + LEAD_OUT_SEC;
    el.currentTime = Math.max(0, segment.start - LEAD_IN_SEC);
    setPlaying(segment.id);
    el.play().catch(() => setPlaying(null));
    const tick = () => {
      if (el.paused || el.currentTime >= end) return stop();
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
  }

  return { audio, playing, toggle, stop };
}

type QuoteSource = {
  segments: Map<number, Segment>;
  speakerName: (label: number) => string; // "S0" until extraction has named the speakers
  playing: number | null;
  toggle: (segment: Segment) => void;
};

export const QuoteContext = createContext<QuoteSource | null>(null);

function Quote({ id, showId = false }: { id: number; showId?: boolean }) {
  const source = useContext(QuoteContext);
  const segment = source?.segments.get(id);
  if (!source || !segment) return null;
  const isPlaying = source.playing === id;
  return (
    <li className={isPlaying ? "quote playing" : "quote"}>
      <button
        type="button"
        className="play"
        onClick={() => source.toggle(segment)}
        aria-label={`${isPlaying ? "Stop" : "Play"} the quote at ${formatTime(segment.start)}`}
      >
        {isPlaying ? "■" : "▶"}
      </button>
      <span className="meta">
        {showId && <span>[{id}]</span>}
        <span>{formatTime(segment.start)}</span>
        <span className="speaker">{source.speakerName(segment.speaker)}</span>
      </span>
      <q>{segment.text}</q>
    </li>
  );
}

// The quotes behind one value, in the order they were said.
export function Quotes({ ids }: { ids: number[] }) {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  return (
    <ul className="quotes">
      {unique.map((id) => (
        <Quote key={id} id={id} />
      ))}
    </ul>
  );
}

// The whole transcript, with the segment ids the model cites.
export function TranscriptView({ segments }: { segments: Segment[] }) {
  return (
    <ol className="quotes transcript">
      {segments.map((s) => (
        <Quote key={s.id} id={s.id} showId />
      ))}
    </ol>
  );
}
