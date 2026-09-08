import { Suspense } from "react";
import { Dashboard } from "@/components/dashboard";

export default function Home() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
