import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Film, Loader2, Send, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { TelegramChannelConfig } from '../types';
import { TelegramNative } from '../services/telegramNative';
import {
  fetchPublicChannelFeed,
  fetchJoinedPrivateChannelFeed,
  fetchPublicTelegramClientChannelFeed,
  inspectTelegramInvite,
  isTelegramInviteLink,
  joinTelegramInvite,
  normalizeTelegramChannelInput,
} from '../services/telegramApi';

interface ConnectChannelModalProps {
  isOpen: boolean;
  initialLink?: string | null;
  onClose: () => void;
  onChannelsConnected: (channels: TelegramChannelConfig[], failedCount: number) => void;
  onChannelHistoryUpdated?: (channel: TelegramChannelConfig) => void;
  onChannelHistoryError?: (error: Error) => void;
  onChannelHistoryComplete?: (channel: TelegramChannelConfig) => void;
  onChannelBlocked?: (channelId: string) => void;
}

interface ChannelLinkResult {
  link: string;
  title: string;
  videoCount?: number;
  error?: string;
}

interface PendingInvite {
  link: string;
  title: string;
  createsJoinRequest: boolean;
  remainingLinks: string[];
  connectedChannels: TelegramChannelConfig[];
  results: ChannelLinkResult[];
}

function splitChannelLinks(value: string): string[] {
  return Array.from(new Set(value.split(/[\s,;]+/).map((link) => link.trim()).filter(Boolean)));
}

export const ConnectChannelModal: React.FC<ConnectChannelModalProps> = ({
  isOpen,
  initialLink = null,
  onClose,
  onChannelsConnected,
  onChannelHistoryUpdated,
  onChannelHistoryError,
  onChannelHistoryComplete,
  onChannelBlocked,
}) => {
  const [channelLinks, setChannelLinks] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState('');
  const [joinNotice, setJoinNotice] = useState('');
  const [pendingInvite, setPendingInvite] = useState<PendingInvite | null>(null);
  const [results, setResults] = useState<ChannelLinkResult[]>([]);
  const [progress, setProgress] = useState('');
  const processedInitialLinkRef = useRef<string | null>(null);

  // The first page is returned immediately; older history keeps loading in the background.
  const historyLoadOptions = {
    onHistoryUpdated: (fullChannel: TelegramChannelConfig) => {
      const videos = fullChannel.items.filter(
        (item) => item.type === 'video' && (item.videoUrl || item.telegramFileId)
      );
      if (videos.length === 0) return;
      onChannelHistoryUpdated?.({
        ...fullChannel,
        items: videos,
        featured: videos[0],
        bannerBackdrop: videos[0].poster || videos[0].backdrop || '',
      });
    },
    onHistoryError: (historyError: Error) => {
      console.warn('Could not finish loading channel history:', historyError);
      setError(`Poori history load nahi ho payi: ${historyError.message}`);
      onChannelHistoryError?.(historyError);
    },
    onHistoryComplete: onChannelHistoryComplete,
    onChannelBlocked,
  };

  const processLinks = async (
    links: string[],
    previousChannels: TelegramChannelConfig[] = [],
    previousResults: ChannelLinkResult[] = [],
  ) => {
    setIsConnecting(true);
    setError('');
    setJoinNotice('');
    setPendingInvite(null);

    const connectedChannels = [...previousChannels];
    const linkResults = [...previousResults];

    try {
      for (let index = 0; index < links.length; index++) {
        const link = links[index];
        setProgress(`Link ${linkResults.length + 1} process ho raha hai...`);
        try {
          let channel: TelegramChannelConfig;
          if (isTelegramInviteLink(link)) {
            if (!Capacitor.isNativePlatform()) {
              throw new Error('Private invite links ke liye Android app me Telegram account login zaroori hai.');
            }
            const authState = await TelegramNative.getAuthState();
            if (authState.step !== 'ready' || !authState.user) {
              throw new Error('Private group/channel connect karne ke liye pehle Telegram account login karein. Public links login ke bina connect ho sakte hain.');
            }
            const invite = await inspectTelegramInvite(link);
            if (!invite.joined) {
              linkResults.push({
                link,
                title: invite.title,
                error: invite.createsJoinRequest ? 'Join request ki zaroorat hai.' : 'Join confirmation baaki hai.',
              });
              setResults([...linkResults]);
              setPendingInvite({
                link,
                title: invite.title,
                createsJoinRequest: invite.createsJoinRequest,
                remainingLinks: links.slice(index + 1),
                connectedChannels,
                results: linkResults,
              });
              setProgress('');
              return;
            }
            setProgress('Private group/channel ke videos load ho rahe hain...');
            channel = await fetchJoinedPrivateChannelFeed(invite.chatId, historyLoadOptions);
          } else {
            const username = normalizeTelegramChannelInput(link);
            const nativeAuth = Capacitor.isNativePlatform()
              ? await TelegramNative.getAuthState()
              : null;
            setProgress('Public group/channel ke videos load ho rahe hain...');
            channel = nativeAuth?.step === 'ready' && nativeAuth.user
              ? await fetchPublicTelegramClientChannelFeed(
                  username,
                  historyLoadOptions,
                )
              : await fetchPublicChannelFeed(username, historyLoadOptions);
          }

          const videos = channel.items.filter(
            (item) => item.type === 'video' && (item.videoUrl || item.telegramFileId)
          );
          if (videos.length === 0) {
            throw new Error('Is channel me koi playable video nahi mila.');
          }
          const videoChannel: TelegramChannelConfig = {
            ...channel,
            sourceLink: isTelegramInviteLink(link)
              ? (/^https?:\/\//i.test(link) ? link : `https://${link}`)
              : `https://t.me/${channel.username.replace(/^@/, '')}`,
            items: videos,
            featured: videos[0],
            bannerBackdrop: videos[0].poster || videos[0].backdrop || '',
          };
          connectedChannels.push(videoChannel);
          linkResults.push({ link, title: videoChannel.title, videoCount: videos.length });
          setResults([...linkResults]);
        } catch (linkError) {
          linkResults.push({
            link,
            title: link,
            error: linkError instanceof Error ? linkError.message : 'Channel connect nahi ho paya.',
          });
          setResults([...linkResults]);
        }
      }

      setProgress('');
      setChannelLinks('');
      if (connectedChannels.length > 0) {
        const failedCount = linkResults.filter((result) => result.error).length;
        onChannelsConnected(connectedChannels, failedCount);
      }
    } finally {
      setIsConnecting(false);
    }
  };

  useEffect(() => {
    if (!initialLink) {
      processedInitialLinkRef.current = null;
      return;
    }
    if (!isOpen || processedInitialLinkRef.current === initialLink) return;

    processedInitialLinkRef.current = initialLink;
    setChannelLinks(initialLink);
    setResults([]);
    void processLinks([initialLink]);
  }, [initialLink, isOpen]);

  const handleConnect = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const links = splitChannelLinks(channelLinks);
    if (links.length === 0) return;
    if (links.length > 1) {
      setError('Ek baar me sirf ek Telegram group/channel link add karein.');
      return;
    }
    setResults([]);
    await processLinks(links);
  };

  const handleJoinAndContinue = async () => {
    if (!pendingInvite) return;
    setIsConnecting(true);
    setError('');
    setJoinNotice('');
    const invite = pendingInvite;

    try {
      const joined = await joinTelegramInvite(invite.link);
      const connectedChannels = [...invite.connectedChannels];
      const linkResults = [...invite.results];
      if (joined.requestPending) {
        setJoinNotice('Telegram par join request bhej di gayi hai. Admin approval ke baad private link dobara connect karein.');
        linkResults[linkResults.length - 1] = {
          link: invite.link,
          title: invite.title,
          error: 'Admin approval pending.',
        };
      } else if (joined.chatId) {
        try {
          const channel = await fetchJoinedPrivateChannelFeed(joined.chatId, historyLoadOptions);
          if (channel.items.length === 0) throw new Error('Channel join ho gaya, lekin koi playable video nahi mila.');
          connectedChannels.push({ ...channel, sourceLink: invite.link });
          linkResults[linkResults.length - 1] = {
            link: invite.link,
            title: channel.title,
            videoCount: channel.items.length,
          };
        } catch (feedError) {
          linkResults[linkResults.length - 1] = {
            link: invite.link,
            title: invite.title,
            error: feedError instanceof Error ? feedError.message : 'Joined channel videos load nahi ho paye.',
          };
        }
      } else {
        throw new Error('Telegram ne channel join confirm nahi kiya.');
      }

      setResults(linkResults);
      setPendingInvite(null);
      if (invite.remainingLinks.length > 0) {
        await processLinks(invite.remainingLinks, connectedChannels, linkResults);
      } else if (connectedChannels.length > 0) {
        onChannelsConnected(connectedChannels, linkResults.filter((result) => result.error).length);
      }
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Private group/channel join nahi ho paya.');
    } finally {
      setIsConnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="safe-area-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-channel-title"
        className="max-h-full w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-zinc-800 bg-[#181818] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#0088cc]/15 text-[#0088cc]">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <h2 id="connect-channel-title" className="font-bold text-white">Connect Telegram Group or Channel</h2>
              <p className="text-xs text-zinc-400">Ek baar me ek Telegram link add karein</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={handleConnect} className="space-y-4 p-5">
          <label htmlFor="telegram-channel-links" className="block space-y-2">
            <span className="text-sm font-medium text-zinc-200">Telegram group/channel link</span>
            <textarea
              id="telegram-channel-links"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              rows={2}
              value={channelLinks}
              onChange={(event) => setChannelLinks(event.target.value)}
              placeholder="https://t.me/group_or_channel"
              className="w-full resize-y rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-zinc-500 focus:border-[#0088cc]"
            />
          </label>

          <p className="flex items-start gap-2 text-xs leading-relaxed text-zinc-400">
            <Film className="mt-0.5 h-4 w-4 shrink-0 text-[#E50914]" />
            Android par public aur private channels ke liye Telegram login zaroori hai, taaki Telegram ki sensitive-content restrictions apply ho saken.
          </p>

          {progress && (
            <div role="status" className="flex items-center gap-2 text-sm text-zinc-200">
              <Loader2 className="h-4 w-4 animate-spin text-[#0088cc]" />
              <span>{progress}</span>
            </div>
          )}

          {pendingInvite && (
            <div className="space-y-3 rounded-xl border border-[#0088cc]/40 bg-[#0088cc]/10 p-4">
              <div>
                <p className="text-sm font-semibold text-white">{pendingInvite.title}</p>
                <p className="mt-1 text-xs text-zinc-300">
                  Is private group/channel me aap joined nahi hain. Connect karne ke liye pehle join karein.
                </p>
              </div>
              <button
                type="button"
                onClick={handleJoinAndContinue}
                disabled={isConnecting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0088cc] px-4 py-2.5 text-sm font-bold text-white hover:bg-[#0077b5] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span>{pendingInvite.createsJoinRequest ? 'Request to Join & Continue' : 'Join Group/Channel & Continue'}</span>
              </button>
            </div>
          )}

          {joinNotice && (
            <div role="status" className="rounded-lg border border-amber-900 bg-amber-950/50 p-3 text-sm text-amber-200">
              {joinNotice}
            </div>
          )}

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {results.length > 0 && (
            <div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
              {results.map((result, index) => (
                <div key={`${result.link}-${index}`} className="flex items-start gap-2 text-xs">
                  {result.error
                    ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                    : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />}
                  <span className={result.error ? 'text-amber-200' : 'text-emerald-200'}>
                    {result.title}: {result.error || `${result.videoCount} videos connected`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            type="submit"
            disabled={isConnecting || !channelLinks.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#E50914] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#b81d24] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isConnecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Channel load ho raha hai...</span>
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                <span>Connect Group/Channel</span>
              </>
            )}
          </button>
        </form>
      </section>
    </div>
  );
};
