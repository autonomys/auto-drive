import { OAuthUser } from '@auto-drive/models'

interface DiscordUser {
  id: string
  username: string
}

const getUserFromAccessToken = async (
  accessToken: string,
): Promise<OAuthUser> => {
  const discordUser = await fetch('https://discord.com/api/users/@me', {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Access-Control-Allow-Origin': '*',
      Authorization: `Bearer ${accessToken}`,
    },
  }).then((response) => {
    if (!response.ok) {
      throw new Error('Failed to fetch user')
    }
    return response.json() as Promise<DiscordUser>
  })

  return {
    provider: 'discord',
    id: discordUser.id,
    username: discordUser.username,
  }
}

export const DiscordAuth = {
  getUserFromAccessToken,
}
