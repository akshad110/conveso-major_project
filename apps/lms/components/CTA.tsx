import Link from "next/link";
import { Plus } from "lucide-react";
import { subjects } from "@/constants";
import { getSubjectGlow } from "@/lib/utils";

/**
 * The one place on the home page that asks for something.
 *
 * It used to lean on /images/cta.svg, an illustration drawn for a light page.
 * In its place is the thing the panel is actually about: the seven subjects, as
 * seven lines of light. It is made of real data, it costs no download, and it
 * tells you what you can build rather than decorating the space where that
 * information should have been.
 */
const Cta = () => {
  return (
    <section className="cta-section">
      <span className="cta-badge">Your tutor, your way</span>

      <h2 className="text-2xl leading-tight">Build a companion</h2>

      <p className="text-sm leading-relaxed text-[var(--ink-dim)]">
        Name it, pick a subject and a voice, and set how long a session runs.
        It will teach that topic, out loud, and write the work down beside the
        conversation.
      </p>

      <div className="flex flex-col gap-2 py-1">
        {subjects.map((subject) => (
          <div key={subject} className="flex items-center gap-3">
            <span
              className="h-px flex-1"
              style={{
                background: `linear-gradient(90deg, ${getSubjectGlow(subject)}, transparent)`,
              }}
            />
            <span className="meta w-24 text-right">{subject}</span>
          </div>
        ))}
      </div>

      <Link href="/companions/new" className="btn btn-flame w-full">
        <Plus size={14} />
        Build a companion
      </Link>
    </section>
  );
};

export default Cta;
