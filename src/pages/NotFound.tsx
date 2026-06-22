import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center p-6 text-center">
      <h1 className="text-4xl font-bold text-fg">404</h1>
      <p className="mt-2 text-fg-muted">This page doesn't exist.</p>
      <Link to="/" className="mt-4 text-vault-500 hover:underline">
        Go home
      </Link>
    </div>
  );
}
