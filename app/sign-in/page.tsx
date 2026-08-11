import { signIn } from "@/auth";
import Image from "next/image";

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="cerebral-auth flex min-h-screen items-center justify-center bg-mist px-4">
      <section className="w-full max-w-md rounded-2xl border border-line bg-surface-card p-7 text-center shadow-soft">
        <div className="brand-tile brand-mark mx-auto flex h-14 w-14 items-center justify-center overflow-hidden rounded-[18px] border border-cobalt/30">
          <Image src="/cerberus_logo_512.png" alt="Cerebral mark" width={46} height={46} priority className="h-[46px] w-[46px] object-contain" />
        </div>
        <div className="mt-5 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-muted">Cerberus Analytics</div>
        <h1 className="brand-wordmark mt-2 text-[25px] font-bold text-ink">CEREBRAL</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">Sign in with an approved account to enter your analytics workspace.</p>
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
            className="focus-ring inline-flex w-full items-center justify-center rounded-lg bg-cobalt px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(89,73,205,0.22)] hover:bg-cobalt/90"
          >
            Continue with Google
          </button>
        </form>
      </section>
    </main>
  );
}
