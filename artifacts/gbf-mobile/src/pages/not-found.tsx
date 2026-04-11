import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-sm border border-slate-100 p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle className="h-7 w-7 text-red-500" />
          <h1 className="text-xl font-bold text-slate-900">404 Page Not Found</h1>
        </div>
        <p className="text-sm text-slate-500">
          The page you are looking for does not exist.
        </p>
      </div>
    </div>
  );
}
