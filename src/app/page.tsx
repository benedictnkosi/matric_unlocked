import Link from "next/link";
import {
  getSubjectLabel,
  getSubjects,
  groupSubjectsByGrade,
} from "@/lib/subjects";

export const dynamic = "force-dynamic";

export default async function Home() {
  let subjects: Awaited<ReturnType<typeof getSubjects>> = [];
  let error: string | null = null;

  try {
    subjects = await getSubjects();
  } catch (err) {
    error =
      err instanceof Error
        ? err.message
        : "Unable to load subjects. Check your Firebase configuration.";
  }

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-slate-100">
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-sm font-medium uppercase tracking-widest text-indigo-600">
              Matric Unlocked
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-900">Subjects</h1>
          </div>
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-700">
            {subjects.length} available
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10">
        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-6 py-5 text-red-800">
            <p className="font-medium">Failed to load subjects</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        ) : subjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-lg font-medium text-slate-900">No subjects yet</p>
            <p className="mt-2 text-sm text-slate-600">
              Add documents to the <code className="rounded bg-slate-100 px-1.5 py-0.5">subjects</code>{" "}
              collection in Firebase to see them here.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {groupSubjectsByGrade(subjects).map((group) => (
              <section key={group.grade}>
                <div className="mb-4 flex items-baseline justify-between gap-4">
                  <h2 className="text-xl font-semibold text-slate-900">{group.label}</h2>
                  <span className="text-sm text-slate-500">
                    {group.subjects.length} subject{group.subjects.length === 1 ? "" : "s"}
                  </span>
                </div>
                <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {group.subjects.map((subject) => (
                    <li key={subject.id}>
                      <Link
                        href={`/subjects/${subject.id}`}
                        className="block rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-200 hover:shadow-md"
                      >
                        <h3 className="text-lg font-semibold text-slate-900">
                          {getSubjectLabel(subject)}
                        </h3>
                        {subject.description ? (
                          <p className="mt-2 text-sm leading-6 text-slate-600">
                            {subject.description}
                          </p>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
