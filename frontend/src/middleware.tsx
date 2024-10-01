import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { AuthService } from "./services/auth";

export async function middleware(req: NextRequest) {
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const { pathname } = req.nextUrl;

  if (!session && pathname.startsWith("/drive")) {
    console.log("redirecting to home: 1");
    return NextResponse.redirect(new URL("/", req.url));
  }

  // @ts-ignore
  const isValidToken = await AuthService.checkAuth(session?.accessToken);
  if (!isValidToken && pathname.startsWith("/drive")) {
    console.log("redirecting to home: 2");
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (isValidToken && !pathname.startsWith("/drive")) {
    console.log("redirecting to drive");
    return NextResponse.redirect(new URL("/drive", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/drive/:path*", "/"],
};
