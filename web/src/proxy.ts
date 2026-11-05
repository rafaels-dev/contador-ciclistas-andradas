import { NextResponse, type NextRequest } from "next/server";
import { TOKEN_COOKIE, accessAllowed } from "@/lib/access";

// no matcher: applies to every request, server actions (POST) included
export function proxy(request: NextRequest) {
  if (!accessAllowed(request.cookies.get(TOKEN_COOKIE)?.value, request.headers.get("host"))) {
    return new NextResponse("Access denied.", { status: 403 });
  }
  return NextResponse.next();
}
