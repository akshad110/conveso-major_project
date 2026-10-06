import Image from "next/image";
import { currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import {
  getUserCompanions,
  getUserSessions,
  getBookmarkedCompanions,
} from "@/lib/actions/companion.actions";
import CompanionsList from "@/components/CompanionsList";
import { formatDuration, getSubjectGlow } from "@/lib/utils";
import { subjects } from "@/constants";

const Profile = async () => {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const companions = await getUserCompanions(user.id);
  const sessionHistory = await getUserSessions(user.id);
  const bookmarkedCompanions = await getBookmarkedCompanions(user.id);

  const minutes = sessionHistory.reduce(
    (total: number, s: Companion) => total + (Number(s.duration) || 0),
    0,
  );

  /**
   * Which subjects this person actually spends their time on.
   *
   * A profile page full of totals tells you how much you have done. This tells
   * you what you have been doing, which is the more useful sentence — and it
   * is the one place the seven hues appear together at full strength, as a bar
   * you read rather than a chart you decode.
   */
  const bySubject = subjects
    .map((subject) => ({
      subject,
      minutes: sessionHistory
        .filter((s: Companion) => s.subject === subject)
        .reduce((t: number, s: Companion) => t + (Number(s.duration) || 0), 0),
    }))
    .filter((s) => s.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);

  return (
    <main className="gap-8">
      <header className="flex flex-wrap items-center gap-5">
        <Image
          src={user.imageUrl}
          alt={user.firstName ?? "You"}
          width={64}
          height={64}
          className="size-16 rounded-full border border-[var(--edge-lit)] object-cover"
        />
        <div className="min-w-0">
          <h1 className="text-2xl">
            {user.firstName} {user.lastName}
          </h1>
          <p className="truncate text-sm text-[var(--ink-dim)]">
            {user.emailAddresses[0].emailAddress}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "sessions", value: String(sessionHistory.length) },
          { label: "time spent", value: formatDuration(minutes) },
          { label: "companions built", value: String(companions.length) },
          { label: "saved", value: String(bookmarkedCompanions.length) },
        ].map(({ label, value }) => (
          <div key={label} className="tool p-4">
            <p className="font-mono text-2xl font-medium text-[var(--ink)]">{value}</p>
            <p className="meta mt-1">{label}</p>
          </div>
        ))}
      </section>

      {bySubject.length > 0 && (
        <section className="panel p-6">
          <p className="meta mb-4">where the time went</p>
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--panel-sunk)]">
            {bySubject.map(({ subject, minutes: m }) => (
              <span
                key={subject}
                title={`${subject} · ${formatDuration(m)}`}
                style={{
                  width: `${(m / minutes) * 100}%`,
                  backgroundColor: getSubjectGlow(subject),
                }}
              />
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
            {bySubject.map(({ subject, minutes: m }) => (
              <span key={subject} className="flex items-center gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: getSubjectGlow(subject) }}
                />
                <span className="meta">
                  {subject} {formatDuration(m)}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      <CompanionsList
        title="Recent sessions"
        companions={sessionHistory}
        empty="Nothing completed yet. Start a session and it lands here."
      />

      <CompanionsList
        title="Saved"
        companions={bookmarkedCompanions}
        empty="Bookmark a companion from the library and it waits for you here."
      />

      <CompanionsList
        title="Built by you"
        companions={companions}
        empty="You have not built a companion yet."
      />
    </main>
  );
};

export default Profile;
