const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export const AuthService = {
  checkAuth: async (token: string): Promise<boolean> => {
    const response = await fetch(`${API_BASE_URL}/auth/session`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Auth-Provider": "google",
      },
    });

    return response.ok;
  },
};
