import React, { useState, useEffect } from 'react';
import {
  User as UserIcon, Send, Shield, Bell, Sparkles, Plus, ExternalLink,
  Check, Smartphone, Trash2, Heart, Film, Tv, LogOut, CheckCircle2,
  Mail, X, RefreshCw, Database, Phone, MessageCircle, CircleHelp, Lightbulb, ShieldCheck
} from 'lucide-react';
import { TelegramChannelConfig } from '../types';
import { useAuth } from '../context/AuthContext';
import { Capacitor } from '@capacitor/core';
import { PUBLIC_ACCOUNT_DELETION_URL, PUBLIC_PRIVACY_POLICY_URL } from '../services/backendApi';

interface ProfileViewProps {
  channels: TelegramChannelConfig[];
  activeChannel: TelegramChannelConfig | null;
  onSelectChannel: (channel: TelegramChannelConfig) => void;
  onRemoveChannel: (channelId: string) => void;
  onOpenConnectModal: () => void;
  favoriteCount: number;
  watchedCount: number;
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  channels,
  activeChannel,
  onSelectChannel,
  onRemoveChannel,
  onOpenConnectModal,
  favoriteCount,
  watchedCount,
}) => {
  const {
    user,
    cloudSyncEnabled,
    cloudSyncConnecting,
    cloudSyncDisabled,
    authError: contextAuthError,
    telegramLoginUrl,
    telegramAuthStep,
    signInWithTelegram,
    submitTelegramPhoneNumber,
    submitTelegramCode,
    submitTelegramPassword,
    signOut,
    deleteCloudAccount,
  } = useAuth();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [telegramLoginInput, setTelegramLoginInput] = useState('');
  const [isPrivacyPolicyOpen, setIsPrivacyPolicyOpen] = useState(false);
  const [isDeleteAccountOpen, setIsDeleteAccountOpen] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(() => {
    return localStorage.getItem('teleflix_profile_avatar') || 'red';
  });

  const avatars = [
    { id: 'red', bg: 'bg-[#E50914]', icon: '☺', label: 'Classic Red' },
    { id: 'blue', bg: 'bg-[#0088cc]', icon: '✈', label: 'Telegram Blue' },
    { id: 'purple', bg: 'bg-purple-600', icon: '★', label: 'VIP Purple' },
    { id: 'emerald', bg: 'bg-emerald-600', icon: '⚡', label: 'Neon Cyber' },
    { id: 'amber', bg: 'bg-amber-500', icon: '🍿', label: 'Cinema Gold' },
  ];

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get('telegramLogin') === 'error') {
      setAuthError('Telegram login did not complete. Please try again.');
      url.searchParams.delete('telegramLogin');
      window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  const handleTelegramSignIn = async (event?: React.MouseEvent<HTMLAnchorElement>) => {
    if (!Capacitor.isNativePlatform()) return;
    event?.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);
    try {
      await signInWithTelegram();
    } catch (err) {
      console.error('Telegram login error:', err);
      setAuthError(err instanceof Error ? err.message : 'Failed to sign in with Telegram');
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleTelegramLoginSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSigningIn(true);
    setAuthError(null);
    try {
      if (telegramAuthStep === 'phone') {
        await submitTelegramPhoneNumber(telegramLoginInput.trim());
      } else if (telegramAuthStep === 'code') {
        await submitTelegramCode(telegramLoginInput.trim());
      } else if (telegramAuthStep === 'password') {
        await submitTelegramPassword(telegramLoginInput);
      }
      setTelegramLoginInput('');
    } catch (error) {
      console.error('Telegram login step failed:', error);
      setAuthError(error instanceof Error ? error.message : 'Could not continue Telegram login.');
    } finally {
      if (telegramAuthStep === 'password') setTelegramLoginInput('');
      setIsSigningIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error('Telegram logout error:', err);
      setAuthError(err instanceof Error ? err.message : 'Could not sign out.');
    }
  };

  const handleDeleteCloudAccount = async () => {
    setIsDeletingAccount(true);
    setAuthError(null);
    try {
      await deleteCloudAccount();
      setIsDeleteAccountOpen(false);
      setAuthError('AMZY cloud account deleted. Telegram remains signed in on this device.');
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Could not delete the cloud account.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  const handleSelectAvatar = (id: string) => {
    setSelectedAvatar(id);
    localStorage.setItem('teleflix_profile_avatar', id);
  };

  const currentAvatarObj = avatars.find((a) => a.id === selectedAvatar) || avatars[0];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-28 space-y-6">
      {/* Profile Header Card */}
      <div className="bg-gradient-to-r from-zinc-900 via-zinc-900/90 to-zinc-950 p-6 rounded-2xl border border-zinc-800 shadow-2xl space-y-5">
        <div className="flex items-center space-x-4 sm:space-x-6">
          {/* Avatar (Telegram picture if logged in, or theme avatar) */}
          <div className="relative flex-shrink-0">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover shadow-xl border-2 border-white/20 select-none"
              />
            ) : (
              <div
                className={`w-16 h-16 sm:w-20 sm:h-20 rounded-2xl ${currentAvatarObj.bg} flex items-center justify-center text-white text-3xl sm:text-4xl font-bold shadow-xl border-2 border-white/20 select-none`}
              >
                {currentAvatarObj.icon}
              </div>
            )}
            {user && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#0088cc] flex items-center justify-center shadow-lg border border-zinc-300">
                <Send className="w-3.5 h-3.5 text-white" />
              </div>
            )}
          </div>

          {/* User Info */}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white truncate">
              {user ? user.displayName : 'AMZY Streamer'}
            </h1>

            <p className="text-xs text-zinc-400 mt-0.5 truncate">
              {user ? (user.username ? `@${user.username}` : 'Telegram account') : `Guest Mode • Connected to ${channels.length} Telegram Channels`}
            </p>
            {user && (
              <div className="mt-2 space-y-1 text-xs text-zinc-300">
                <p className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-zinc-400" />
                  <span>Mobile: {user.phoneNumber || 'Not shared by Telegram'}</span>
                </p>
                <p className="flex items-center gap-1.5">
                  <Send className="h-3 w-3 text-zinc-400" />
                  <span>Telegram ID: {user.uid.replace(/^telegram:/, '')}</span>
                </p>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              {user ? (
                <span className="bg-emerald-950/80 border border-emerald-600/50 text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  <span>Telegram Account Linked</span>
                </span>
              ) : (
                <span className="bg-[#E50914]/20 border border-[#E50914]/40 text-[#E50914] text-[10px] font-black px-2 py-0.5 rounded uppercase">
                  TELEGRAM GUEST
                </span>
              )}

              {cloudSyncEnabled && (
                <span className="bg-sky-950/80 border border-sky-500/50 text-sky-300 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center space-x-1">
                  <Database className="w-3 h-3 text-sky-400" />
                  <span>Supabase Backend</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Avatar Picker */}
        <div className="pt-2 border-t border-zinc-800/80">
          <p className="text-xs text-zinc-400 font-semibold mb-2">Choose Avatar Theme:</p>
          <div className="flex items-center space-x-3 overflow-x-auto no-scrollbar py-1">
            {avatars.map((av) => (
              <button
                key={av.id}
                onClick={() => handleSelectAvatar(av.id)}
                className={`w-10 h-10 rounded-xl ${av.bg} flex items-center justify-center text-white text-lg font-bold transition-transform active:scale-90 flex-shrink-0 ${
                  selectedAvatar === av.id ? 'ring-2 ring-white scale-105 shadow-lg' : 'opacity-70 hover:opacity-100'
                }`}
                title={av.label}
              >
                {av.icon}
              </button>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-3 gap-3 pt-2">
          <div className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/50 text-center">
            <span className="text-lg sm:text-xl font-bold text-white block">{channels.length}</span>
            <span className="text-[11px] text-zinc-400">Channels</span>
          </div>
          <div className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/50 text-center">
            <span className="text-lg sm:text-xl font-bold text-[#E50914] block">{favoriteCount}</span>
            <span className="text-[11px] text-zinc-400">Favorites</span>
          </div>
          <div className="bg-zinc-800/60 p-3 rounded-xl border border-zinc-700/50 text-center">
            <span className="text-lg sm:text-xl font-bold text-emerald-400 block">{watchedCount}</span>
            <span className="text-[11px] text-zinc-400">History</span>
          </div>
        </div>
      </div>

      {/* TELEGRAM SIGN-IN SECTION */}
      <div className="bg-gradient-to-r from-zinc-900 to-zinc-950 p-5 rounded-2xl border border-zinc-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#0088cc] flex items-center justify-center shadow">
              <Send className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">Telegram Account & Supabase</h2>
              <p className="text-xs text-zinc-400">
                {user
                  ? cloudSyncEnabled
                    ? 'Telegram account connected to Supabase'
                    : cloudSyncDisabled
                      ? 'AMZY cloud account deleted; cloud sync is off'
                    : 'Connect Supabase to sync your account and channels'
                  : Capacitor.isNativePlatform()
                    ? 'Sign in securely with your phone number and Telegram code'
                    : 'Sign in with Telegram to sync your data'}
              </p>
            </div>
          </div>

          {user && (
            <button
              onClick={handleLogout}
              className="flex items-center space-x-1.5 text-xs text-zinc-400 hover:text-red-400 bg-zinc-800/80 hover:bg-zinc-800 px-2.5 py-1.5 rounded-lg border border-zinc-700 transition-colors"
              title="Sign Out from Telegram"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Logout</span>
            </button>
          )}
        </div>

        {(authError || contextAuthError) && (
          <div className="p-3 bg-red-950/40 border border-red-800/60 rounded-xl text-xs text-red-300">
            {authError || contextAuthError}
          </div>
        )}

        {user ? (
          /* Logged In Telegram State */
          <>
            <div className="p-4 bg-zinc-800/40 rounded-xl border border-zinc-700/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3 min-w-0">
                {user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'Telegram user'}
                    className="w-12 h-12 rounded-full border-2 border-emerald-500/80 object-cover flex-shrink-0"
                  />
                ) : (
                  <div className={`w-12 h-12 rounded-full ${currentAvatarObj.bg} border-2 border-emerald-500/80 flex items-center justify-center text-white text-2xl flex-shrink-0`}>
                    {currentAvatarObj.icon}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-bold text-white truncate">{user.displayName || 'Telegram user'}</h3>
                    <span className="bg-emerald-500/20 text-emerald-400 text-[10px] font-bold px-1.5 py-0.2 rounded border border-emerald-500/30">
                      Telegram Verified
                    </span>
                  </div>
                  <p className="text-xs text-zinc-300 truncate">{user.username ? `@${user.username}` : 'Telegram account'}</p>
                  <p className="text-[10px] text-zinc-500 mt-0.5">Telegram ID: {user.uid.replace('telegram:', '')}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800/60 px-3 py-1.5 rounded-lg font-medium flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Telegram Signed In</span>
                </span>
              </div>
            </div>
            {cloudSyncEnabled && (
              <button
                type="button"
                onClick={() => setIsDeleteAccountOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-red-900/70 px-3 py-2 text-xs font-semibold text-red-300 transition-colors hover:bg-red-950/40"
              >
                <Trash2 className="h-4 w-4" />
                Delete AMZY cloud account
              </button>
            )}
            {cloudSyncDisabled && user && (
              <button
                type="button"
                onClick={() => void handleTelegramSignIn()}
                disabled={isSigningIn || cloudSyncConnecting}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0088cc] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {isSigningIn && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                Enable cloud sync
              </button>
            )}
            {Capacitor.isNativePlatform() && !cloudSyncEnabled && (
              <div className="space-y-3 rounded-xl border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-200/90">
                <p role={contextAuthError ? 'alert' : 'status'}>
                  {contextAuthError
                    ? `Supabase verification failed: ${contextAuthError}`
                    : cloudSyncConnecting
                      ? 'Supabase cloud sync is connecting automatically. Complete Telegram verification if prompted.'
                      : 'Supabase cloud sync will connect automatically. Complete Telegram verification if prompted.'}
                </p>
                {!cloudSyncConnecting && (
                  <button
                    type="button"
                    onClick={() => void handleTelegramSignIn()}
                    disabled={isSigningIn}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0088cc] px-3 py-2 font-semibold text-white transition-colors hover:bg-[#0077b5] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSigningIn && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    {isSigningIn ? 'Connecting...' : 'Retry Supabase sync'}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          /* Not Logged In State */
          <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-800 space-y-3">
            {Capacitor.isNativePlatform() ? (
            <div className="space-y-3">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Your Telegram login stays on this device. Cloud sync is not enabled yet.
              </p>

              {telegramAuthStep === 'phone' || telegramAuthStep === 'code' || telegramAuthStep === 'password' ? (
                <form onSubmit={handleTelegramLoginSubmit} className="space-y-3">
                  {telegramAuthStep === 'phone' && (
                    <>
                      <label htmlFor="telegram-phone" className="block text-xs text-zinc-400">
                        Phone number with country code
                      </label>
                      <input
                        id="telegram-phone"
                        type="tel"
                        autoComplete="tel"
                        inputMode="tel"
                        required
                        value={telegramLoginInput}
                        onChange={(event) => setTelegramLoginInput(event.target.value)}
                        placeholder="+1 555 123 4567"
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-[#0088cc]"
                      />
                    </>
                  )}
                  {telegramAuthStep === 'code' && (
                    <>
                      <label htmlFor="telegram-code" className="block text-xs text-zinc-400">
                        Enter the login code sent by Telegram
                      </label>
                      <input
                        id="telegram-code"
                        type="text"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        required
                        value={telegramLoginInput}
                        onChange={(event) => setTelegramLoginInput(event.target.value)}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-[#0088cc]"
                      />
                    </>
                  )}
                  {telegramAuthStep === 'password' && (
                    <>
                      <label htmlFor="telegram-password" className="block text-xs text-zinc-400">
                        Telegram two-step verification password
                      </label>
                      <input
                        id="telegram-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={telegramLoginInput}
                        onChange={(event) => setTelegramLoginInput(event.target.value)}
                        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-white outline-none focus:border-[#0088cc]"
                      />
                    </>
                  )}
                  <button
                    type="submit"
                    disabled={isSigningIn}
                    className="w-full sm:w-auto flex items-center justify-center space-x-3 bg-[#0088cc] hover:bg-[#0077b5] disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg"
                  >
                    {isSigningIn ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>{telegramAuthStep === 'phone' ? 'Send Telegram code' : 'Continue'}</span>
                      </>
                    )}
                  </button>
                </form>
              ) : telegramAuthStep === 'initializing' ? (
                <span className="flex items-center gap-2 text-xs text-zinc-400">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Preparing secure Telegram login...
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleTelegramSignIn()}
                  disabled={isSigningIn}
                  className="w-full sm:w-auto flex items-center justify-center space-x-3 bg-[#0088cc] hover:bg-[#0077b5] disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg"
                >
                  {isSigningIn ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>Connect Telegram account</span>
                </button>
              )}
            </div>
            ) : (
            <div className="p-4 bg-zinc-800/30 rounded-xl border border-zinc-800 space-y-3">
              <p className="text-xs text-zinc-300 leading-relaxed">
                Sign in with Telegram to save your account, channels, and favorites in Supabase.
              </p>
              <a
                href={telegramLoginUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto flex items-center justify-center space-x-3 bg-[#0088cc] hover:bg-[#0077b5] disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-xl shadow-lg transition-transform active:scale-98"
              >
                <Send className="w-4 h-4" />
                <span>Login with Telegram</span>
              </a>
            </div>
            )}
          </div>
        )}
      </div>

      {/* Connected Telegram Channels */}
      <div className="bg-zinc-900/80 p-5 rounded-2xl border border-zinc-800 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Send className="w-5 h-5 text-[#0088cc]" />
            <h2 className="text-base font-bold text-white">Telegram Groups & Channels</h2>
          </div>
          <button
            onClick={onOpenConnectModal}
            className="flex items-center space-x-1.5 bg-[#E50914] hover:bg-[#b81d24] text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow transition-transform active:scale-95"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Connect Group/Channel</span>
          </button>
        </div>

        {channels.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-800/30 p-5 text-center">
            <Film className="mx-auto mb-2 h-6 w-6 text-zinc-500" />
            <p className="text-sm font-medium text-zinc-200">Abhi koi group ya channel connect nahi hai</p>
            <p className="mt-1 text-xs text-zinc-400">Public ya private Telegram group/channel ka link paste karke uske videos Home par dekhein.</p>
          </div>
        ) : (
        <div className="space-y-3">
          {channels.map((ch) => {
            const isActive = activeChannel?.id === ch.id;
            const isPublicTelegramChat = ch.isPublicTelegramChat
              ?? !ch.username.startsWith('private_');

            return (
              <div
                key={ch.id}
                className={`p-3.5 rounded-xl border transition-all ${
                  isActive
                    ? 'bg-[#E50914]/15 border-[#E50914]'
                    : 'bg-zinc-800/50 border-zinc-700/60'
                }`}
              >
                <div
                  onClick={() => onSelectChannel(ch)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    {ch.avatar ? (
                      <img src={ch.avatar} alt={ch.title} className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center font-bold text-white flex-shrink-0">
                        {ch.title.charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center space-x-2">
                        <p className="text-sm font-bold text-white truncate">{ch.title}</p>
                        {isActive && (
                          <span className="bg-[#E50914] text-white text-[9px] font-black px-1.5 py-0.2 rounded">
                            ACTIVE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">
                        {isPublicTelegramChat
                          ? `@${ch.username}`
                          : `Private Telegram ${ch.telegramChatKind || 'channel'}`} • {ch.items.filter((item) => item.type === 'video').length} videos
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onRemoveChannel(ch.id);
                      }}
                      aria-label={`Remove ${ch.title}`}
                      title="Remove channel"
                      className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-950/60 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    {!ch.telegramChatId && (
                      <a
                        href={`https://t.me/${ch.username}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 text-zinc-400 hover:text-white"
                        title="Open on Telegram"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                    {isActive && <Check className="w-5 h-5 text-[#E50914]" />}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        )}
      </div>

      <section className="overflow-hidden rounded-3xl border border-slate-700/50 bg-[#1d2933] p-5 shadow-xl sm:p-8">
        <h2 className="mb-5 px-1 text-xl font-bold text-sky-300 sm:text-2xl">Help</h2>
        <div className="space-y-2">
          <a
            href="mailto:service@chakrabortycompliance.in?subject=AMZY%20Support"
            className="flex min-h-20 items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-white/5 sm:gap-6 sm:px-4"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-500 text-white shadow-lg">
              <MessageCircle className="h-8 w-8" />
            </span>
            <span className="text-lg font-medium text-white sm:text-2xl">Ask a Question</span>
          </a>
          <a
            href="https://telegram.org/faq"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-20 items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-white/5 sm:gap-6 sm:px-4"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-lg">
              <CircleHelp className="h-8 w-8" />
            </span>
            <span className="text-lg font-medium text-white sm:text-2xl">Telegram FAQ</span>
          </a>
          <a
            href="https://telegram.org/features"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-20 items-center gap-4 rounded-2xl px-2 py-3 transition-colors hover:bg-white/5 sm:gap-6 sm:px-4"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-purple-500 text-white shadow-lg">
              <Lightbulb className="h-8 w-8" />
            </span>
            <span className="text-lg font-medium text-white sm:text-2xl">Telegram Features</span>
          </a>
          <button
            type="button"
            onClick={() => setIsPrivacyPolicyOpen(true)}
            className="flex min-h-20 w-full items-center gap-4 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-white/5 sm:gap-6 sm:px-4"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-green-500 text-white shadow-lg">
              <ShieldCheck className="h-8 w-8" />
            </span>
            <span className="text-lg font-medium text-white sm:text-2xl">Privacy Policy</span>
          </button>
        </div>
      </section>

      {isPrivacyPolicyOpen && (
        <div
          className="safe-area-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setIsPrivacyPolicyOpen(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="amzy-privacy-policy-title"
            className="max-h-full w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-[#181818] p-5 text-sm text-zinc-300 shadow-2xl sm:p-7"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between gap-4">
              <h2 id="amzy-privacy-policy-title" className="text-xl font-bold text-white sm:text-2xl">
                AMZY Privacy Policy
              </h2>
              <button
                type="button"
                onClick={() => setIsPrivacyPolicyOpen(false)}
                aria-label="Close privacy policy"
                className="rounded-full p-2 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-5 text-xs text-zinc-500">Last updated: October 27, 2026</p>
            <div className="space-y-5 leading-relaxed">
              <section>
                <h3 className="mb-1 font-semibold text-white">Information and storage</h3>
                <p>AMZY stores preferences, Telegram session data, local history, and downloaded files on your device.</p>
              </section>
              <section>
                <h3 className="mb-1 font-semibold text-white">Telegram sign-in</h3>
                <p>Telegram handles login codes, two-step passwords, and the TDLib session on-device. For cloud sync, AMZY sends your Telegram ID, name, username, profile-photo URL, and phone number when available to Supabase.</p>
              </section>
              <section>
                <h3 className="mb-1 font-semibold text-white">Cloud sync</h3>
                <p>Supabase stores your account profile, selected channel/group references, and favorites for sync. Telegram supplies channel posts and media. Watch Rooms store nicknames, room activity, shared video metadata, and playback state until room expiry. AMZY does not include ads or analytics SDKs.</p>
              </section>
              <section>
                <h3 className="mb-1 font-semibold text-white">Your choices and contact</h3>
                <p>
                  Delete your cloud account in Profile or use the public{' '}
                  <a href={PUBLIC_ACCOUNT_DELETION_URL} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2">account deletion page</a>.
                  This does not erase Telegram data or local downloads. For privacy questions, email{' '}
                  <a
                    href="mailto:service@chakrabortycompliance.in?subject=AMZY%20Privacy%20Question"
                    className="text-sky-300 underline underline-offset-2"
                  >
                    service@chakrabortycompliance.in
                  </a>.
                </p>
                <p className="mt-2">
                  <a href={PUBLIC_PRIVACY_POLICY_URL} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline underline-offset-2">Open public privacy policy</a>
                </p>
              </section>
            </div>
          </section>
        </div>
      )}

      {isDeleteAccountOpen && (
        <div className="safe-area-overlay fixed inset-0 z-[80] flex items-center justify-center bg-black/80" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-cloud-account-title" className="max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-xl border border-red-900/70 bg-zinc-950 p-5 shadow-2xl">
            <h2 id="delete-cloud-account-title" className="text-lg font-bold text-white">Delete AMZY cloud account?</h2>
            <p className="text-sm leading-relaxed text-zinc-300">This permanently deletes your synced AMZY profile, saved channels, favorites, playlists, and device key. Telegram stays signed in on this device; local downloads and Telegram data are not deleted.</p>
            {authError && <p role="alert" className="text-xs text-red-300">{authError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsDeleteAccountOpen(false)} disabled={isDeletingAccount} className="rounded-lg px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void handleDeleteCloudAccount()} disabled={isDeletingAccount} className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-2 text-sm font-bold text-white hover:bg-red-600 disabled:opacity-50">
                {isDeletingAccount && <RefreshCw className="h-4 w-4 animate-spin" />}
                {isDeletingAccount ? 'Deleting…' : 'Delete cloud account'}
              </button>
            </div>
          </section>
        </div>
      )}

    </div>
  );
};
