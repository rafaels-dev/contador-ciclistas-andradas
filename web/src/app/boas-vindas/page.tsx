import { connection } from "next/server";
import { Suspense } from "react";
import { detectarPlaca, pastaMotor, usarPlaca } from "@/lib/motor";
import { Assistente } from "./assistente";

export default function PaginaBoasVindas() {
  return (
    <Suspense fallback={null}>
      <Conteudo />
    </Suspense>
  );
}

async function Conteudo() {
  await connection();
  return <Assistente inicial={{ placa: detectarPlaca(), usarPlaca: usarPlaca(), podeInstalar: !!pastaMotor(), temChave: !!process.env.OPENROUTER_API_KEY }} />;
}
