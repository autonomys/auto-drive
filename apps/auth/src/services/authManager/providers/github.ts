import { OAuthUser } from '@auto-drive/models'

type GitHubUser = {
  id: number
  login: string
  avatar_url: string
}

const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const githubUser = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((res) => {
    if (res.status >= 400) {
      throw new Error('Failed to fetch user info')
    }
    return res.json() as Promise<GitHubUser>
  })

  return {
    provider: 'github',
    // Convert numeric GitHub ID to string if you want a uniform type
    id: githubUser.id.toString(),
    username: githubUser.login,
    avatarUrl: githubUser.avatar_url,
  }
}

export const GitHubAuth = {
  getUserFromAccessToken,
}
