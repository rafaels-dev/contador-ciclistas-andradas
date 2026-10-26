import { connection } from "next/server";
import { tarefasEmAndamento } from "@/lib/atividade";
import { FaixaAtualizacao } from "./faixa-atualizacao";

/**
 * Faixa de atualização do app desktop. O servidor só informa quantas
 * tarefas estão rodando (reiniciar interrompe todas); quem sabe da versão
 * nova é o Electron, lido pela ponte na própria faixa.
 */
export async function Atualizacao() {
  await connection();
  return <FaixaAtualizacao ocupadas={tarefasEmAndamento().length} />;
}
