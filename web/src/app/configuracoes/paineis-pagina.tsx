"use client";

import { useState } from "react";
import { TITULO_PAINEL } from "@/lib/ui";
import type { EstadoConfiguracao } from "./actions";
import { PainelChave, PainelMotor, PainelPlaca } from "./paineis";

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-4">
      <h2 className={TITULO_PAINEL}>{titulo}</h2>
      {children}
    </section>
  );
}

export function Paineis({ inicial }: { inicial: EstadoConfiguracao }) {
  const [estado, setEstado] = useState(inicial);
  return (
    <>
      <Secao titulo="Placa de vídeo">
        <PainelPlaca estado={estado} aoMudar={(usar) => setEstado((e) => ({ ...e, usarPlaca: usar }))} />
      </Secao>
      <Secao titulo="Motor de detecção">
        <PainelMotor estado={estado} />
      </Secao>
      <Secao titulo="Inteligência artificial (OpenRouter)">
        <PainelChave temChave={estado.temChave} />
      </Secao>
    </>
  );
}
