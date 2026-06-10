import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center px-6">
      <p className="text-sm font-medium uppercase tracking-wider text-slate-500">
        turborepo-ts
      </p>
      <h1 className="mt-3 text-4xl font-semibold">profound-takehome</h1>
      <p className="mt-4 max-w-xl text-lg text-slate-600">
        This project is ready for agent-first development with typed checks,
        durable docs, and a repeatable verification loop.
      </p>
      <div className="mt-8">
        <Button>Build the first workflow</Button>
      </div>
    </main>
  );
}
