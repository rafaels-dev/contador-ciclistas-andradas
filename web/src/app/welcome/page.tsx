import { connection } from "next/server";
import { Suspense } from "react";
import { readState } from "../settings/actions";
import { Wizard } from "./wizard";

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  return <Wizard initial={await readState()} />;
}
