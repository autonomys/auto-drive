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
  const user = await AuthService.checkAuth(session?.accessToken).catch((e) => {
    console.log("error", e);
    return null;
  });

  if (!user && pathname !== "/") {
    console.log("redirecting to home: 2");
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (user && user.onboarded && !pathname.startsWith("/drive")) {
    console.log("redirecting to drive");
    return NextResponse.redirect(new URL("/drive", req.url));
  }

  if (user && !user.onboarded && !pathname.startsWith("/onboarding")) {
    console.log("redirecting to onboarding");
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/drive/:path*", "/", "/onboarding"],
};
