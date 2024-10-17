import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";
import { AuthService } from "./services/auth";
import { UserInfo } from "./models/User";

export async function middleware(req: NextRequest) {
  const session = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });

  const { pathname } = req.nextUrl;

  if (!session && pathname.startsWith("/drive")) {
    console.log("redirecting to home: 1");
    return NextResponse.redirect(new URL("/", req.url));
  }

  const userInfo: UserInfo | null = await AuthService.checkAuth(
    // @ts-ignore
    session?.accessToken
  ).catch((e) => {
    console.log("error", e);
    return null;
  });

  if (!userInfo?.user && pathname !== "/") {
    console.log("redirecting to home: 2");
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (
    userInfo?.user &&
    userInfo.user.onboarded &&
    !pathname.startsWith("/drive")
  ) {
    console.log("redirecting to drive");
    return NextResponse.redirect(new URL("/drive", req.url));
  }

  if (
    userInfo?.user &&
    !userInfo.user.onboarded &&
    !pathname.startsWith("/onboarding")
  ) {
    console.log("redirecting to onboarding");
    return NextResponse.redirect(new URL("/onboarding", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/drive/:path*", "/", "/onboarding"],
};
