import { signIn } from "@/auth";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="flex min-h-screen items-center justify-center bg-mist px-4">
      <section className="w-full max-w-md rounded-md border border-line bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-sage">
          <span className="font-mono text-lg font-bold text-cobalt">A</span>
        </div>
        <h1 className="mt-4 text-xl font-bold text-ink">Sign in</h1>
        <p className="mt-2 text-sm text-slate-600">Use an approved Google account to access Analytics Hub.</p>
        {params.error ? (
          <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            Sign-in is limited to Tripledot accounts and approved partner domains.
          </p>
        ) : null}
        <form
          className="mt-5"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <button
            type="submit"
            className="focus-ring inline-flex w-full items-center justify-center rounded-md bg-cobalt px-4 py-2 text-sm font-semibold text-white hover:bg-cobalt/90"
          >
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
