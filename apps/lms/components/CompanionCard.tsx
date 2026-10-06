"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { Bookmark, Clock } from "lucide-react";
import { addBookmark, removeBookmark } from "@/lib/actions/companion.actions";
import { CLASSROOM_URL, COURTROOM_URL } from "@/lib/scenes";
import { getSubjectColor, getSubjectGlow, formatDuration } from "@/lib/utils";

interface CompanionCardProps {
  id: string;
  name: string;
  topic: string;
  subject: string;
  duration: number;
  color: string;
  bookmarked: boolean;
}

/**
 * One companion, as a card.
 *
 * The card is a dark panel like everything else — the subject's colour appears
 * as a lit hairline along its top edge and on its label, not as a wash across
 * the whole thing. Seven pastel rectangles in a grid was the old look and it
 * made the page feel like a box of sweets; the same seven hues used as light
 * instead of paint keep the subject legible at a glance without shouting.
 *
 * The icon tile keeps its pastel fill, because the glyphs in /public/icons are
 * drawn in solid black and would vanish on anything darker.
 */
const CompanionCard = ({
  id,
  name,
  topic,
  subject,
  duration,
  bookmarked,
}: CompanionCardProps) => {
  const pathname = usePathname();
  const [saved, setSaved] = useState(bookmarked);
  const [pending, startTransition] = useTransition();
  const glow = getSubjectGlow(subject);

  const toggleBookmark = () => {
    // Flip first, reconcile after: a bookmark that waits on a round trip feels
    // broken, and there is nothing to lose by being wrong for 200ms.
    const next = !saved;
    setSaved(next);
    startTransition(async () => {
      try {
        if (next) await addBookmark(id, pathname);
        else await removeBookmark(id, pathname);
      } catch {
        setSaved(!next);
      }
    });
  };

  return (
    <article
      className="companion-card"
      style={{ ["--subject-lit" as string]: glow }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid size-10 shrink-0 place-items-center rounded-[10px]"
          style={{ backgroundColor: getSubjectColor(subject) }}
        >
          <Image src={`/icons/${subject}.svg`} alt="" width={19} height={19} />
        </span>

        <p className="meta mt-1 flex-1 truncate" style={{ color: glow }}>
          {subject}
        </p>

        <button
          onClick={toggleBookmark}
          disabled={pending}
          className="companion-bookmark"
          aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
          aria-pressed={saved}
        >
          <Bookmark
            size={14}
            className={saved ? "text-[var(--flame)]" : "text-[var(--ink-faint)]"}
            fill={saved ? "var(--flame)" : "none"}
          />
        </button>
      </div>

      <div>
        <h2 className="text-xl leading-snug">{name}</h2>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-[var(--ink-dim)]">
          {topic}
        </p>
      </div>

      <div className="mt-auto flex items-center gap-2">
        <Clock size={13} className="text-[var(--ink-faint)]" />
        <span className="meta">{formatDuration(duration)}</span>
      </div>

      {subject === "law" ? (
        <a href={COURTROOM_URL} target="_blank" rel="noopener noreferrer" className="btn-subject">
          Enter courtroom
        </a>
      ) : subject === "language" ? (
        <a href={CLASSROOM_URL} target="_blank" rel="noopener noreferrer" className="btn-subject">
          Enter classroom
        </a>
      ) : (
        <Link href={`/companions/${id}`} className="btn-subject">
          Start session
        </Link>
      )}
    </article>
  );
};

export default CompanionCard;
