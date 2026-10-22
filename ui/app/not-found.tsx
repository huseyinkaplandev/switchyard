export default function NotFound() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-4">
      <h1 className="text-4xl font-bold font-mono">404</h1>
      <p className="text-sm text-zinc-500 font-mono">Page not found</p>
      <a href="/" className="text-xs text-emerald-400 hover:underline font-mono">
        Return Home
      </a>
    </div>
  );
}
