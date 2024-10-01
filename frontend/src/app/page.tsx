"use client";

import { useCallback, useState } from "react";

export default function App() {
  const [isLoading, setIsLoading] = useState(false);

  const handleAuth = useCallback(() => {
    setIsLoading(true);

    // Replace this URL with your actual Google OAuth 2.0 authorization endpoint
    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth";

    // These are example parameters. Replace with your actual values
    const params = new URLSearchParams({
      client_id: process.env.NEXT_PUBLIC_GOOGLE_AUTH_CLIENT_ID!,
      redirect_uri: "http://localhost:8080/api/auth/callback/google",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "openid email",
    });

    // Redirect to the authorization URL
    window.location.assign(`${authUrl}?${params.toString()}`);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-blue-500 to-purple-600">
      <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">
          Welcome Back
        </h1>
        <p className="text-center mb-8 text-gray-600">
          Sign in with your Google account to continue
        </p>
        <div className="flex justify-center">
          <button
            onClick={handleAuth}
            disabled={isLoading}
            className="bg-black hover:bg-gray-800 text-white font-bold py-3 px-6 rounded-full 
                       border-2 border-transparent hover:border-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900
                       transition duration-300 ease-in-out transform hover:-translate-y-1 hover:scale-105
                       flex items-center justify-center w-full max-w-xs"
            aria-label="Sign in with Google"
          >
            {isLoading ? (
              <div className="flex items-center justify-center">
                <svg
                  className="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
                Redirecting...
              </div>
            ) : (
              <>
                <svg
                  className="w-6 h-6 mr-2"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    fill="#ffffff"
                    d="M12.24 10.285V14.4h6.806c-.275 1.765-2.056 5.174-6.806 5.174-4.095 0-7.439-3.389-7.439-7.574s3.345-7.574 7.439-7.574c2.33 0 3.891.989 4.785 1.849l3.254-3.138C18.189 1.186 15.479 0 12.24 0c-6.635 0-12 5.365-12 12s5.365 12 12 12c6.926 0 11.52-4.869 11.52-11.726 0-.788-.085-1.39-.189-1.989H12.24z"
                  />
                </svg>
                Sign in with Google
              </>
            )}
          </button>
        </div>
        <p className="mt-8 text-center text-sm text-gray-600">
          By signing in, you agree to our{" "}
          <a href="#" className="font-medium text-blue-600 hover:text-blue-500">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="font-medium text-blue-600 hover:text-blue-500">
            Privacy Policy
          </a>
        </p>
      </div>
    </div>
  );
}
