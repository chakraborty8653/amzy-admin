import React, { useState } from 'react';
import { RefreshCw, Send, X } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { useAuth } from '../context/AuthContext';

interface FirstLaunchLoginModalProps {
  onSkip: () => void;
}

export const FirstLaunchLoginModal: React.FC<FirstLaunchLoginModalProps> = ({ onSkip }) => {
  const {
    authError,
    signInWithTelegram,
    submitTelegramPhoneNumber,
    submitTelegramCode,
    submitTelegramPassword,
    telegramAuthStep,
  } = useAuth();
  const [value, setValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const isNative = Capacitor.isNativePlatform();

  const handleSignIn = async () => {
    setIsSubmitting(true);
    setLocalError(null);
    try {
      await signInWithTelegram();
    } catch (error) {
      console.error('Could not start Telegram sign-in from welcome prompt:', error);
      setLocalError(error instanceof Error ? error.message : 'Telegram sign-in could not be started.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setLocalError(null);
    try {
      if (telegramAuthStep === 'phone') {
        await submitTelegramPhoneNumber(value.trim());
      } else if (telegramAuthStep === 'code') {
        await submitTelegramCode(value.trim());
      } else if (telegramAuthStep === 'password') {
        await submitTelegramPassword(value);
      }
      setValue('');
    } catch (error) {
      console.error('Telegram sign-in step failed in welcome prompt:', error);
      setLocalError(error instanceof Error ? error.message : 'Could not continue Telegram sign-in.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const authStep = isNative
    ? telegramAuthStep
    : 'loggedOut';
  const inputStep = authStep === 'phone' || authStep === 'code' || authStep === 'password';

  return (
    <div className="safe-area-overlay fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-login-title"
        className="max-h-full w-full max-w-md space-y-5 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-700 bg-zinc-950 p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0088cc]/15 text-[#0088cc]">
              <Send className="h-5 w-5" />
            </span>
            <div>
              <h2 id="welcome-login-title" className="text-lg font-bold text-white">
                Welcome to AMZY
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Login with Telegram to save your account and connected channels.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSkip}
            aria-label="Skip Telegram login"
            className="rounded-full p-2 text-zinc-400 hover:bg-zinc-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {(localError || authError) && (
          <p role="alert" className="rounded-lg border border-red-900 bg-red-950/50 p-3 text-xs text-red-200">
            {localError || authError}
          </p>
        )}

        {inputStep ? (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label htmlFor="welcome-telegram-input" className="block text-xs text-zinc-300">
              {authStep === 'phone' && 'Phone number with country code'}
              {authStep === 'code' && 'Enter the login code sent by Telegram'}
              {authStep === 'password' && 'Telegram two-step verification password'}
            </label>
            <input
              id="welcome-telegram-input"
              type={authStep === 'password' ? 'password' : 'text'}
              autoComplete={
                authStep === 'phone' ? 'tel' : authStep === 'code' ? 'one-time-code' : 'current-password'
              }
              inputMode={authStep === 'phone' ? 'tel' : authStep === 'code' ? 'numeric' : undefined}
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={authStep === 'phone' ? '+1 555 123 4567' : undefined}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-white outline-none focus:border-[#0088cc]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0088cc] px-4 py-3 text-sm font-bold text-white hover:bg-[#0077b5] disabled:opacity-50"
            >
              {isSubmitting && <RefreshCw className="h-4 w-4 animate-spin" />}
              {authStep === 'phone' ? 'Send Telegram code' : 'Continue'}
            </button>
          </form>
        ) : authStep === 'initializing' ? (
          <p role="status" className="flex items-center gap-2 text-sm text-zinc-300">
            <RefreshCw className="h-4 w-4 animate-spin" />
            Preparing secure Telegram login...
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void handleSignIn()}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0088cc] px-4 py-3 text-sm font-bold text-white hover:bg-[#0077b5] disabled:opacity-50"
          >
            {isSubmitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isNative ? 'Login with Telegram' : 'Continue with Telegram'}
          </button>
        )}

        <button
          type="button"
          onClick={onSkip}
          className="w-full rounded-lg px-4 py-2 text-xs font-medium text-zinc-400 hover:bg-zinc-900 hover:text-white"
        >
          Skip for now
        </button>
      </section>
    </div>
  );
};
