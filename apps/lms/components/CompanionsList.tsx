import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";
import { cn, getSubjectColor, getSubjectGlow, formatDuration } from "@/lib/utils";

interface CompanionsListProps {
  title: string;
  companions?: Companion[];
  classNames?: string;
  /** Shown when there is nothing to list. An empty panel is a dead end. */
  empty?: string;
}

/**
 * A list of sessions, as rows rather than as a table.
 *
 * The shadcn <Table> this used to be brought its own light-mode styling and a
 * header row labelled "Lessons / Subject / Duration" above three columns you
 * could already read. Rows that are links, with the subject as a coloured
 * hairline down the left edge, say the same thing in less space and work at
 * phone width without a horizontal scroll.
 */
const CompanionsList = ({ title, companions, classNames, empty }: CompanionsListProps) => {
  return (
    <article className={cn("companion-list", classNames)}>
      <div className="flex items-baseline justify-between gap-4 pb-1">
        <h2 className="text-2xl">{title}</h2>
        {companions && companions.length > 0 && (
          <span className="meta">{companions.length}</span>
        )}
      </div>

      {!companions || companions.length === 0 ? (
        <p className="py-8 text-sm leading-relaxed text-[var(--ink-dim)]">
          {empty ?? "Nothing here yet."}
        </p>
      ) : (
        <ul className="-mx-3 py-2">
          {companions.map(({ id, subject, name, topic, duration }, index) => (
            <li key={`${id}-${index}`}>
              <Link
                href={`/companions/${id}`}
                className="group flex items-center gap-4 rounded-[12px] px-3 py-3 transition-colors hover:bg-[var(--panel-raised)]"
              >
                <span
                  className="h-10 w-[3px] shrink-0 rounded-full"
                  style={{ backgroundColor: getSubjectGlow(subject) }}
                />

                <span
                  className="grid size-10 shrink-0 place-items-center rounded-[10px] max-sm:hidden"
                  style={{ backgroundColor: getSubjectColor(subject) }}
                >
                  <Image src={`/icons/${subject}.svg`} alt="" width={19} height={19} />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-[var(--ink)]">
                    {name}
                  </span>
                  <span className="block truncate text-sm text-[var(--ink-dim)]">
                    {topic}
                  </span>
                </span>

                <span
                  className="meta shrink-0 max-md:hidden"
                  style={{ color: getSubjectGlow(subject) }}
                >
                  {subject}
                </span>

                <span className="meta w-[72px] shrink-0 text-right">
                  {formatDuration(duration)}
                </span>

                <ArrowUpRight
                  size={15}
                  className="shrink-0 text-[var(--ink-faint)] transition-colors group-hover:text-[var(--ink)]"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};

export default CompanionsList;
