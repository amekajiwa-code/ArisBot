// Pure authorization check: a turn is allowed only when a channel is bound AND
// the message comes from the configured owner in that exact channel.

export function isAuthorized({ userId, channelId, allowedUserId, boundChannelId }) {
  return Boolean(boundChannelId) && userId === allowedUserId && channelId === boundChannelId;
}
