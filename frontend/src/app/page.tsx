import GoogleProvider from "next-auth/providers/google";
import { FaGoogle } from "react-icons/fa";

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
};

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-lg shadow-md overflow-hidden">
        <div className="p-6 space-y-6">
          <div className="text-center">
            <span className="text-2xl justify-center font-semibold text-gray-800 flex items-center">
              <img
                src="/autonomys.png"
                alt="Auto Drive"
                className="w-8 h-8 mr-2"
              />
              Auto Drive
            </span>
            <p className="text-sm text-gray-500 mt-1">
              Sign in to access your files
            </p>
          </div>
          <button className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
            <FaGoogle />
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
}
