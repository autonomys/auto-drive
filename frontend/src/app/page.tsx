"use client";

import { LoaderCircle } from "lucide-react";
import { signIn } from "next-auth/react";
import { useCallback, useState } from "react";
import { GoogleIcon } from "../components/common/GoogleIcon";

export default function App() {
  const [isLoading, setIsLoading] = useState(false);

  const handleAuth = useCallback(() => {
    setIsLoading(true);
    signIn("google");
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-blue-500 to-purple-600">
      <div className="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
        <h1 className="text-3xl font-bold mb-6 text-center text-gray-800">
          Welcome to Auto-Drive
        </h1>
        <p className="text-center mb-8 text-gray-600">
          Sign in with your Google account to start using our decentralized
          storage service
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
                <LoaderCircle className="w-4 h-4 mr-2 animate-spin" />
                Redirecting...
              </div>
            ) : (
              <>
                <GoogleIcon />
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
