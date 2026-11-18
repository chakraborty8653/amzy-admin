import React, { useEffect, useRef, useState } from 'react';
import { Bell, Check, Copy, Download } from 'lucide-react';
import { ActiveTab } from '../types';
import { playNetflixTaDum } from '../utils/sound';
import { backendFetch } from '../services/backendApi';

interface HeaderProps {
  onTabChange: (tab: ActiveTab) => void;
  downloadCount: number;
  onTelegramLinkClick: (link: string) => void;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  createdAt: string;
}

const READ_NOTIFICATIONS_KEY = 'amzy_read_notifications';
const NOTIFICATION_LINK_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"']+|(?:t\.me|telegram\.me)\/[^\s<>"']+/gi;

interface NotificationMessagePart {
  text: string;
  href?: string;
  telegramLink?: string;
}

function getNotificationMessageParts(message: string): NotificationMessagePart[] {
  const parts: NotificationMessagePart[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = NOTIFICATION_LINK_PATTERN.exec(message)) !== null) {
    const rawLink = match[0];
    const link = rawLink.replace(/[),.!?;:\]}]+$/, '');
    if (!link) continue;

    const linkStart = match.index;
    if (linkStart > cursor) parts.push({ text: message.slice(cursor, linkStart) });

    const trailingText = rawLink.slice(link.length);
    try {
      const href = /^https?:\/\//i.test(link) ? link : `https://${link}`;
      const parsedUrl = new URL(href);
      if (parsedUrl.protocol === 'https:' || parsedUrl.protocol === 'http:') {
        const host = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
        parts.push({
          text: link,
          href: parsedUrl.toString(),
          telegramLink: host === 't.me' || host === 'telegram.me' ? parsedUrl.toString() : undefined,
        });
      } else {
        parts.push({ text: rawLink });
      }
    } catch {
      parts.push({ text: rawLink });
    }

    if (trailingText) parts.push({ text: trailingText });
    cursor = linkStart + rawLink.length;
  }

  if (cursor < message.length) parts.push({ text: message.slice(cursor) });
  return parts;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      console.warn('Clipboard API could not copy the notification link; trying fallback:', error);
    }
  }

  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.position = 'fixed';
  input.style.opacity = '0';
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand('copy');
  input.remove();
  if (!copied) throw new Error('The notification link could not be copied.');
}

function getReadNotificationIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(READ_NOTIFICATIONS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch (error) {
    console.error('Could not read notification state:', error);
    return [];
  }
}

export const Header: React.FC<HeaderProps> = ({ onTabChange, downloadCount, onTelegramLinkClick }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(getReadNotificationIds);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [copyErrorLink, setCopyErrorLink] = useState<string | null>(null);
  const requestInFlight = useRef(false);

  const loadNotifications = async () => {
    if (requestInFlight.current) return;
    requestInFlight.current = true;
    try {
      const response = await backendFetch('/notifications');
      if (!response.ok) throw new Error(`Notification load failed (${response.status})`);
      const data: { notifications?: AppNotification[]; error?: string } = await response.json();
      if (!Array.isArray(data.notifications)) {
        throw new Error(data.error || 'The notification response is invalid.');
      }
      setNotifications(data.notifications);
      setNotificationError(null);
    } catch (error) {
      console.error('Could not load app notifications:', error);
      setNotificationError('Notifications abhi load nahi ho sakin.');
    } finally {
      requestInFlight.current = false;
    }
  };

  useEffect(() => {
    void loadNotifications();
    const intervalId = window.setInterval(() => void loadNotifications(), 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const unreadCount = notifications.filter((notification) => (
    !readNotificationIds.includes(notification.id)
  )).length;

  const toggleNotifications = () => {
    const willOpen = !isNotificationsOpen;
    setIsNotificationsOpen(willOpen);
    playNetflixTaDum();
    if (willOpen) {
      void loadNotifications();
      const nextReadIds = Array.from(new Set([
        ...readNotificationIds,
        ...notifications.map((notification) => notification.id),
      ])).slice(-200);
      setReadNotificationIds(nextReadIds);
      try {
        localStorage.setItem(READ_NOTIFICATIONS_KEY, JSON.stringify(nextReadIds));
      } catch (error) {
        console.error('Could not save notification read state:', error);
      }
    }
  };

  const handleCopyLink = async (link: string) => {
    try {
      await copyTextToClipboard(link);
      setCopiedLink(link);
      setCopyErrorLink(null);
    } catch (error) {
      console.error('Could not copy notification link:', error);
      setCopiedLink(null);
      setCopyErrorLink(link);
    }
  };

  return (
  <header className="app-header fixed top-0 left-0 right-0 z-40 bg-[#141414]/75 backdrop-blur-md shadow-2xl">
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <button
        type="button"
        onClick={() => {
          playNetflixTaDum();
          onTabChange('home');
        }}
        aria-label="AMZY home"
        className="flex items-center gap-2.5 hover:scale-105 transition-transform duration-200"
      >
        <img src="/amzy-logo.png" alt="" aria-hidden="true" className="h-10 w-10 object-contain" />
        <span className="font-bebas text-3xl tracking-wider text-[#E50914]">AMZY</span>
      </button>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Download"
          title="Download"
          onClick={() => {
            playNetflixTaDum();
            onTabChange('downloads');
          }}
          className="relative p-2 text-zinc-300 hover:text-white transition-colors"
        >
          <Download className="w-5 h-5" />
          {downloadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-[#E50914] px-1 text-[9px] font-bold leading-4 text-white">
              {downloadCount > 99 ? '99+' : downloadCount}
            </span>
          )}
        </button>
        <button
          type="button"
          aria-label="Notifications"
          title="Notifications"
          aria-expanded={isNotificationsOpen}
          aria-haspopup="dialog"
          onClick={toggleNotifications}
          className="relative p-2 text-zinc-300 hover:text-white transition-colors"
        >
          <Bell className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 min-w-4 h-4 rounded-full bg-[#E50914] px-1 text-[9px] font-bold leading-4 text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </div>
    </div>
    {isNotificationsOpen && (
      <>
        <button
          type="button"
          aria-label="Close notifications"
          onClick={() => setIsNotificationsOpen(false)}
          className="fixed left-0 top-full z-40 h-[100dvh] w-full cursor-default"
        />
        <section
          role="dialog"
          aria-label="Notifications"
          className="absolute right-4 top-full z-50 max-h-[min(70dvh,32rem)] w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <h2 className="text-sm font-bold text-white">Notifications</h2>
            <button
              type="button"
              onClick={() => void loadNotifications()}
              className="text-xs text-zinc-400 hover:text-white"
            >
              Refresh
            </button>
          </div>
          <div className="max-h-[calc(min(70vh,32rem)-3rem)] overflow-y-auto">
            {notificationError ? (
              <p role="status" className="p-4 text-sm text-amber-300">{notificationError}</p>
            ) : notifications.length === 0 ? (
              <p className="p-4 text-sm text-zinc-400">Abhi koi notification nahi hai.</p>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {notifications.map((notification) => {
                  const messageParts = getNotificationMessageParts(notification.message);
                  return (
                    <li key={notification.id} className="space-y-1 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold text-white">{notification.title}</h3>
                        {!readNotificationIds.includes(notification.id) && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#E50914]" />
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm text-zinc-300">
                        {messageParts.map((part, index) => {
                          if (!part.href) {
                            return (
                              <React.Fragment key={`${notification.id}-text-${index}`}>
                                {part.text}
                              </React.Fragment>
                            );
                          }

                          const href = part.href;
                          return (
                            <span
                              key={`${notification.id}-link-${index}`}
                              className="inline-flex max-w-full items-baseline gap-1"
                            >
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(event) => {
                                if (!part.telegramLink) return;
                                event.preventDefault();
                                setIsNotificationsOpen(false);
                                onTelegramLinkClick(part.telegramLink);
                              }}
                              className="break-all text-sky-400 underline underline-offset-2 hover:text-sky-300"
                            >
                              {part.text}
                            </a>
                            <button
                              type="button"
                              aria-label={copyErrorLink === href
                                ? 'Could not copy link'
                                : copiedLink === href ? 'Link copied' : 'Copy link'}
                              title={copyErrorLink === href
                                ? 'Could not copy link'
                                : copiedLink === href ? 'Copied' : 'Copy link'}
                              onClick={() => void handleCopyLink(href)}
                              className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                            >
                              {copiedLink === href
                                ? <Check className="h-3.5 w-3.5 text-emerald-400" />
                                : <Copy className="h-3.5 w-3.5" />}
                            </button>
                            </span>
                          );
                        })}
                      </p>
                      {copyErrorLink && messageParts.some((part) => part.href === copyErrorLink) && (
                        <p role="status" className="text-[11px] text-amber-300">Link copy nahi ho saka.</p>
                      )}
                      <time className="block text-[11px] text-zinc-500" dateTime={notification.createdAt}>
                        {new Date(notification.createdAt).toLocaleString()}
                      </time>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </>
    )}
  </header>
  );
};
