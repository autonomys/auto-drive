import { OAuthUser } from '@auto-drive/models'

type GoogleUser = {
  email: string
  id: string
  verified_email: boolean
  picture: string
  hd: string
}

const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const googleUser = await fetch(
    'https://www.googleapis.com/oauth2/v1/userinfo',
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  ).then((res) => {
    if (res.status >= 400) {
      throw new Error('Failed to fetch user info')
    }
    return res.json() as Promise<GoogleUser>
  })

  return {
    provider: 'google',
    id: googleUser.id,
    username: googleUser.email,
  }
}

export const GoogleAuth = {
  getUserFromAccessToken,
}
