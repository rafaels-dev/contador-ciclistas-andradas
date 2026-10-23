import { NextResponse, type NextRequest } from "next/server";
import { COOKIE_TOKEN, acessoLiberado } from "@/lib/acesso";

// sem matcher: vale para toda requisição, inclusive as server actions (POST)
export function proxy(request: NextRequest) {
  if (!acessoLiberado(request.cookies.get(COOKIE_TOKEN)?.value, request.headers.get("host"))) {
    return new NextResponse("Acesso negado.", { status: 403 });
  }
  return NextResponse.next();
}
