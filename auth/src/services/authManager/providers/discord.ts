import { OAuthUser } from '@auto-drive/models'

interface DiscordUser {
  id: string
  username: string
  avatar: string | null
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

  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=64`
    : undefined

  return {
    provider: 'discord',
    id: discordUser.id,
    username: discordUser.username,
    avatarUrl,
  }
}

export const DiscordAuth = {
  getUserFromAccessToken,
}
