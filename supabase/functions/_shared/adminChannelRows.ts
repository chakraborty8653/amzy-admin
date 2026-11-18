export function deduplicateAdminChannelRows(
  rows: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const groups = new Map<string, {
    row: Record<string, unknown>;
    userIds: Set<string>;
  }>();

  rows.forEach((row, index) => {
    const username = typeof row.channel_username === 'string'
      ? row.channel_username.trim().replace(/^@/, '').toLowerCase()
      : '';
    const isPrivateAlias = /^private_\d+$/.test(username);
    const chatId = row.telegram_chat_id === null || row.telegram_chat_id === undefined
      ? ''
      : String(row.telegram_chat_id).trim();
    const normalizedChatId = /^-100\d+$/.test(chatId) ? chatId.slice(4) : chatId;
    const key = username && !isPrivateAlias
      ? `username:${username}`
      : normalizedChatId
        ? `chat:${normalizedChatId}`
        : username
          ? `username:${username}`
          : `row:${String(row.id ?? index)}`;
    let group = groups.get(key);

    if (!group) {
      group = { row, userIds: new Set<string>() };
      groups.set(key, group);
    } else if (!group.row.channelLink && row.channelLink) {
      group.row = { ...group.row, channelLink: row.channelLink };
    }

    if (row.user_id !== null && row.user_id !== undefined) {
      group.userIds.add(String(row.user_id));
    }
  });

  return Array.from(groups.values(), ({ row, userIds }) => {
    const { user_id: _userId, ...channel } = row;
    return {
      ...channel,
      userIds: Array.from(userIds),
      userCount: userIds.size,
    };
  });
}
