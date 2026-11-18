import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import {
  backendFetch,
  clearTelegramSessionToken,
  getBackendUrl,
  getTelegramSessionToken,
  initializeTelegramSessionToken,
  setTelegramSessionToken,
} from '../services/backendApi';
import {
  TelegramNative,
  type TelegramNativeAuthStep,
  type TelegramNativeAuthState,
} from '../services/telegramNative';

export interface AuthUser {
  uid: string;
  displayName: string;
  photoURL: string | null;
  username: string | null;
  phoneNumber: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  loginCompleted: boolean;
  telegramAuthStep: TelegramNativeAuthStep;
  cloudSyncEnabled: boolean;
  cloudSyncConnecting: boolean;
  cloudSyncDisabled: boolean;
  authError: string | null;
  telegramLoginUrl: string;
  signInWithTelegram: () => Promise<void>;
  submitTelegramPhoneNumber: (phoneNumber: string) => Promise<void>;
  submitTelegramCode: (code: string) => Promise<void>;
  submitTelegramPassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  deleteCloudAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  loginCompleted: false,
  telegramAuthStep: 'initializing',
  cloudSyncEnabled: false,
  cloudSyncConnecting: false,
  cloudSyncDisabled: false,
  authError: null,
  telegramLoginUrl: '',
  signInWithTelegram: async () => {},
  submitTelegramPhoneNumber: async () => {},
  submitTelegramCode: async () => {},
  submitTelegramPassword: async () => {},
  signOut: async () => {},
  deleteCloudAccount: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [backendSessionUser, setBackendSessionUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginCompleted, setLoginCompleted] = useState(false);
  const [telegramAuthStep, setTelegramAuthStep] = useState<TelegramNativeAuthStep>('initializing');
  const [cloudSyncConnecting, setCloudSyncConnecting] = useState(false);
  const [cloudSyncDisabled, setCloudSyncDisabledState] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const nativeLoginRequested = useRef(false);
  const nativeOAuthStarted = useRef(false);
  const nativeAutoConnectUid = useRef<string | null>(null);
  const nativeCloudSyncDisabled = useRef(false);
  const nativeAuthCallbackReceived = useRef(false);
  const usesSupabaseFunction = Boolean(import.meta.env.VITE_SUPABASE_FUNCTION_URL);
  const isNativePlatform = Capacitor.isNativePlatform();
  const telegramLoginUrl = (() => {
    const url = new URL(getBackendUrl('/auth/telegram/start'), window.location.origin);
    if (Capacitor.isNativePlatform()) {
      url.searchParams.set('return_to', 'amzy://auth');
    }
    return url.toString();
  })();

  const startNativeOAuth = async () => {
    if (nativeOAuthStarted.current) return;
    nativeOAuthStarted.current = true;
    setCloudSyncConnecting(true);
    setAuthError(null);
    try {
      const nativeState = await TelegramNative.getAuthState();
      if (!nativeState.user) throw new Error('Telegram account is not signed in on this device.');
      const challengeResponse = await backendFetch('/auth/native/challenge');
      const challengeData: { challenge?: string; botUsername?: string; error?: string } = await challengeResponse.json();
      if (!challengeResponse.ok || !challengeData.challenge || !challengeData.botUsername) {
        throw new Error(challengeData.error || 'Could not start cloud sync.');
      }
      await TelegramNative.startBotVerification({
        botUsername: challengeData.botUsername,
        challenge: challengeData.challenge,
      });
      const proof = await TelegramNative.signDeviceProof({
        challenge: challengeData.challenge,
        uid: nativeState.user.uid,
      });
      const sessionBody = JSON.stringify({
        challenge: challengeData.challenge,
        publicKey: proof.publicKey,
        signature: proof.signature,
        uid: nativeState.user.uid,
        displayName: nativeState.user.displayName,
        username: nativeState.user.username,
        photoURL: nativeState.user.photoURL,
        phoneNumber: nativeState.user.phoneNumber,
      });
      let response: Response | null = null;
      // The bot confirms the Telegram account asynchronously; wait up to ~40 seconds.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        response = await backendFetch('/auth/native/session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: sessionBody,
        });
        if (response.status !== 409) break;
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
      }
      if (!response || response.status === 409) {
        throw new Error('Telegram verification timed out. Please try again.');
      }
      const data: { token?: string; user?: AuthUser; error?: string } = await response.json();
      if (!response.ok || !data.token || !data.user) {
        throw new Error(data.error || 'Could not connect cloud sync.');
      }
      await setTelegramSessionToken(data.token);
      setBackendSessionUser(data.user);
      setLoginCompleted(true);
      setAuthError(null);
    } catch (error) {
      await clearTelegramSessionToken();
      setBackendSessionUser(null);
      console.error('Could not connect cloud sync with device key:', error);
      setAuthError(error instanceof Error ? error.message : 'Could not connect cloud sync.');
    } finally {
      nativeOAuthStarted.current = false;
      nativeLoginRequested.current = false;
      setCloudSyncConnecting(false);
    }
  };

  useEffect(() => {
    let isMounted = true;
    if (Capacitor.isNativePlatform()) {
      let authStateListener: PluginListenerHandle | undefined;
      let browserFinishedListener: PluginListenerHandle | undefined;
      let browserFinishedTimeout: number | undefined;
      let backendUser: AuthUser | null = null;
      let backendSessionChecked = false;
      // TDLib can finish logging in before getAuthState() returns, so the newest event wins over that snapshot.
      let latestNativeState: TelegramNativeAuthState | null = null;
      const resolveNativeState = (
        snapshot: TelegramNativeAuthState,
        eventState: TelegramNativeAuthState | null,
      ): TelegramNativeAuthState => {
        if (!eventState) return snapshot;
        if (snapshot.user && !eventState.user && eventState.step !== 'loggedOut') return snapshot;
        return eventState;
      };
      const handledNativeLoginCodes = new Set<string>();

      const handleNativeAuthUrl = async (url: string) => {
        const authUrl = new URL(url);
        const loginCode = authUrl.searchParams.get('telegram_code');
        if (loginCode) {
          if (handledNativeLoginCodes.has(loginCode)) return;
          handledNativeLoginCodes.add(loginCode);
          setLoading(true);
          setCloudSyncConnecting(true);
          setAuthError(null);
          try {
            const response = await backendFetch('/auth/telegram/exchange', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: loginCode }),
            });
            const data: { token: string; user: AuthUser; error?: string } = await response.json();
            const currentNativeState = await TelegramNative.getAuthState();
            if (!response.ok || !data.token || !data.user) {
              throw new Error(data.error || 'Could not verify Telegram login for cloud sync.');
            }
            if (!currentNativeState.user || currentNativeState.user.uid !== data.user.uid) {
              throw new Error('The Telegram account verified for cloud sync does not match the account signed in on this device.');
            }
            await setTelegramSessionToken(data.token);
            backendUser = data.user;
            setBackendSessionUser(data.user);
            setUser(currentNativeState.user);
            setTelegramAuthStep(currentNativeState.step);
            setLoginCompleted(true);
            setAuthError(null);
            nativeLoginRequested.current = false;
            nativeOAuthStarted.current = false;
            if (currentNativeState.user.phoneNumber) {
              try {
                const profileResponse = await backendFetch('/user/profile', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ phoneNumber: currentNativeState.user.phoneNumber }),
                });
                if (!profileResponse.ok) {
                  throw new Error(`Phone number save failed (${profileResponse.status}).`);
                }
              } catch (error) {
                console.error('Could not save native Telegram phone number to Supabase:', error);
                setAuthError('Signed in, but the phone number could not be saved to Supabase.');
              }
            }
            void Browser.close().catch((error: unknown) => {
              console.warn('Could not close the Telegram verification browser:', error);
            });
          } catch (error) {
            await clearTelegramSessionToken();
            backendUser = null;
            setBackendSessionUser(null);
            nativeLoginRequested.current = false;
            nativeOAuthStarted.current = false;
            console.error('Failed to verify native Telegram account for cloud sync:', error);
            setAuthError(error instanceof Error ? error.message : 'Could not verify Telegram login for cloud sync.');
          } finally {
            setCloudSyncConnecting(false);
            setLoading(false);
          }
          return;
        }

        if (authUrl.searchParams.get('telegramLogin') === 'error') {
          nativeLoginRequested.current = false;
          nativeOAuthStarted.current = false;
          setCloudSyncConnecting(false);
          setAuthError('Telegram cloud verification did not finish. Please try again.');
          setLoading(false);
        }
      };

      const appUrlListener = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
        const authUrl = new URL(url);
        if (authUrl.searchParams.has('telegram_code') || authUrl.searchParams.has('telegramLogin')) {
          nativeAuthCallbackReceived.current = true;
          if (browserFinishedTimeout !== undefined) {
            window.clearTimeout(browserFinishedTimeout);
            browserFinishedTimeout = undefined;
          }
        }
        void handleNativeAuthUrl(url);
      });

      const applyNativeAuthState = (state: TelegramNativeAuthState) => {
        if (!isMounted) return;
        setTelegramAuthStep(state.step);
        setUser(state.user);
        if (state.error) setAuthError(state.error);
        if (state.step === 'loggedOut') {
          nativeAutoConnectUid.current = null;
          nativeLoginRequested.current = false;
          nativeOAuthStarted.current = false;
          setCloudSyncConnecting(false);
        }
        if (state.step === 'ready' && state.user && backendSessionChecked) {
          if (backendUser?.uid === state.user.uid) {
            setLoginCompleted(true);
            nativeLoginRequested.current = false;
          } else if (nativeLoginRequested.current) {
            void startNativeOAuth();
          } else if (
            usesSupabaseFunction
            && !nativeCloudSyncDisabled.current
            && nativeAutoConnectUid.current !== state.user.uid
          ) {
            nativeAutoConnectUid.current = state.user.uid;
            nativeLoginRequested.current = true;
            void startNativeOAuth();
          } else if (!usesSupabaseFunction) {
            setAuthError('Supabase cloud sync is not configured in this app build.');
          }
        }
        setLoading(false);
      };

      void (async () => {
        try {
          authStateListener = await TelegramNative.addListener('authStateChanged', (state) => {
            latestNativeState = state;
            applyNativeAuthState(state);
          });
          browserFinishedListener = await Browser.addListener('browserFinished', () => {
            if (!nativeOAuthStarted.current || backendUser || nativeAuthCallbackReceived.current) return;
            if (browserFinishedTimeout !== undefined) window.clearTimeout(browserFinishedTimeout);
            // A callback arriving after this still completes the login and clears the message.
            browserFinishedTimeout = window.setTimeout(() => {
              browserFinishedTimeout = undefined;
              if (backendUser || nativeAuthCallbackReceived.current) return;
              nativeOAuthStarted.current = false;
              nativeLoginRequested.current = false;
              setCloudSyncConnecting(false);
              setAuthError('Telegram verification complete nahi hui. Dobara try karne ke liye Retry dabaiye.');
            }, 20000);
          });
          await initializeTelegramSessionToken();
          const syncPreference = await TelegramNative.getCloudSyncDisabled();
          nativeCloudSyncDisabled.current = syncPreference.disabled;
          setCloudSyncDisabledState(syncPreference.disabled);
          const nativeSnapshot = await TelegramNative.getAuthState();
          const nativeState = resolveNativeState(nativeSnapshot, latestNativeState);
          latestNativeState = nativeState;
          applyNativeAuthState(nativeState);
          const token = getTelegramSessionToken();
          if (token) {
            try {
              const response = await backendFetch('/auth/session');
              if (response.status === 410) {
                await clearTelegramSessionToken();
                await TelegramNative.setCloudSyncDisabled({ disabled: true });
                nativeCloudSyncDisabled.current = true;
                setCloudSyncDisabledState(true);
                backendUser = null;
                setBackendSessionUser(null);
              } else {
              if (!response.ok) throw new Error(`Session check failed (${response.status})`);
              const data: { user: AuthUser | null } = await response.json();
              let currentNativeState = resolveNativeState(nativeState, latestNativeState);
              for (let attempt = 0;
                data.user && !currentNativeState.user && currentNativeState.step === 'ready' && attempt < 4;
                attempt += 1
              ) {
                await new Promise((resolve) => window.setTimeout(resolve, 250));
                currentNativeState = resolveNativeState(
                  await TelegramNative.getAuthState(),
                  latestNativeState,
                );
                latestNativeState = currentNativeState;
              }
              if (data.user && currentNativeState.user?.uid === data.user.uid) {
                backendUser = data.user;
                setBackendSessionUser(data.user);
                setLoginCompleted(true);
              } else if (data.user && !currentNativeState.user && currentNativeState.step === 'ready') {
                backendUser = data.user;
                setBackendSessionUser(data.user);
              } else {
                backendUser = null;
                setBackendSessionUser(null);
                await clearTelegramSessionToken();
              }
              }
            } catch (error) {
              await clearTelegramSessionToken();
              console.error('Failed to restore verified native Telegram session:', error);
            }
          }
          backendSessionChecked = true;
          latestNativeState = resolveNativeState(nativeState, latestNativeState);
          applyNativeAuthState(latestNativeState);
          const launchUrl = await CapacitorApp.getLaunchUrl();
          if (launchUrl?.url) await handleNativeAuthUrl(launchUrl.url);
        } catch (error) {
          console.error('Failed to initialize native Telegram login:', error);
          if (isMounted) {
            setTelegramAuthStep('loggedOut');
            setAuthError(error instanceof Error ? error.message : 'Could not initialize Telegram login.');
            setLoading(false);
          }
        }
      })();

      return () => {
        isMounted = false;
        if (browserFinishedTimeout !== undefined) window.clearTimeout(browserFinishedTimeout);
        void authStateListener?.remove();
        void browserFinishedListener?.remove();
        void appUrlListener.then((listener) => listener.remove());
      };
    }

    const handledCodes = new Set<string>();

    const handleAuthUrl = async (url: string): Promise<boolean> => {
      const authUrl = new URL(url);
      const hashParams = new URLSearchParams(authUrl.hash.slice(1));
      const loginCode = authUrl.searchParams.get('telegram_code') || hashParams.get('telegram_code');
      const loginError = authUrl.searchParams.get('telegramLogin') === 'error';

      if (loginCode) {
        if (handledCodes.has(loginCode)) return true;
        handledCodes.add(loginCode);
        if (isMounted) {
          setLoading(true);
          setAuthError(null);
        }
        try {
          const response = await backendFetch('/auth/telegram/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: loginCode }),
          });
          const data: { token: string; user: AuthUser; error?: string } = await response.json();
          if (!response.ok || !data.token || !data.user) {
            throw new Error(data.error || 'Could not complete Telegram login.');
          }
          await setTelegramSessionToken(data.token);
          setBackendSessionUser(data.user);
          if (isMounted) {
            const currentUrl = new URL(window.location.href);
            const hashParams = new URLSearchParams(currentUrl.hash.slice(1));
            const hadAuthCode = currentUrl.searchParams.has('telegram_code') || hashParams.has('telegram_code');
            currentUrl.searchParams.delete('telegram_code');
            hashParams.delete('telegram_code');
            if (hadAuthCode) {
              currentUrl.searchParams.set('tab', 'profile');
              currentUrl.hash = hashParams.size ? hashParams.toString() : '';
              window.history.replaceState({}, '', `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
            }
            setUser(data.user);
            setLoginCompleted(true);
          }
        } catch (error) {
          console.error('Failed to exchange Telegram login code:', error);
          await clearTelegramSessionToken();
          if (isMounted) {
            setUser(null);
            setBackendSessionUser(null);
            setAuthError(error instanceof Error ? error.message : 'Could not complete Telegram login.');
            setLoading(false);
          }
        }
        if (isMounted) setLoading(false);
        return true;
      }

      if (loginError && isMounted) {
        setUser(null);
        setBackendSessionUser(null);
        setAuthError('Telegram did not finish signing in. Please try again.');
        window.history.replaceState({}, '', '/?tab=profile&telegramLogin=error');
        return true;
      }

      if (authUrl.protocol === 'amzy:' && isMounted) {
        setUser(null);
        setAuthError('AMZY reopened without a Telegram login code. Please start login again.');
        setLoading(false);
        return true;
      }
      return false;
    };

    const restoreSession = async () => {
      await initializeTelegramSessionToken();
      const hasAuthResult = await handleAuthUrl(window.location.href);
      if (!hasAuthResult) {
        const token = getTelegramSessionToken();
        if (token || !usesSupabaseFunction) {
          try {
            const response = await backendFetch('/auth/session');
            if (!response.ok) throw new Error(`Session check failed (${response.status})`);
            const data: { user: AuthUser | null } = await response.json();
            if (isMounted) {
              setUser(data.user);
              setBackendSessionUser(data.user);
            }
          } catch (error) {
            await clearTelegramSessionToken();
            console.error('Failed to restore Telegram session:', error);
          }
        }
      }
      if (isMounted) setLoading(false);
    };

    void restoreSession().catch((error: unknown) => {
      console.error('Failed to initialize Telegram authentication:', error);
      if (isMounted) setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [usesSupabaseFunction]);

  const signInWithTelegram = async () => {
    setAuthError(null);
    setLoginCompleted(false);
    if (isNativePlatform) {
      if (!usesSupabaseFunction) {
        throw new Error('Supabase cloud sync is not configured in this app build.');
      }
      nativeLoginRequested.current = true;
      nativeOAuthStarted.current = false;
      await TelegramNative.setCloudSyncDisabled({ disabled: false });
      nativeCloudSyncDisabled.current = false;
      setCloudSyncDisabledState(false);
      setLoading(true);
      try {
        const state = await TelegramNative.startLogin();
        setTelegramAuthStep(state.step);
        setUser(state.user);
        setAuthError(state.error);
        if (state.step === 'ready') void startNativeOAuth();
      } finally {
        setLoading(false);
      }
      return;
    }

    if (usesSupabaseFunction) {
      window.location.assign(telegramLoginUrl);
      return;
    }

    const response = await backendFetch('/auth/telegram/start', { method: 'POST' });
    const data: { url?: string; error?: string } = await response.json();
    if (!response.ok || !data.url) {
      throw new Error(data.error || 'Could not start Telegram login.');
    }
    window.location.assign(data.url);
  };

  const submitTelegramPhoneNumber = async (phoneNumber: string) => {
    setAuthError(null);
    await TelegramNative.setPhoneNumber({ phoneNumber });
  };

  const submitTelegramCode = async (code: string) => {
    setAuthError(null);
    await TelegramNative.checkCode({ code });
  };

  const submitTelegramPassword = async (password: string) => {
    setAuthError(null);
    await TelegramNative.checkPassword({ password });
  };

  const signOut = async () => {
    if (isNativePlatform) {
      await TelegramNative.logOut();
      await clearTelegramSessionToken();
      setUser(null);
      setBackendSessionUser(null);
      setTelegramAuthStep('phone');
      setLoginCompleted(false);
      setCloudSyncConnecting(false);
      nativeAutoConnectUid.current = null;
      nativeLoginRequested.current = false;
      nativeOAuthStarted.current = false;
      nativeAuthCallbackReceived.current = false;
      return;
    }
    const response = await backendFetch('/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error(`Telegram logout failed (${response.status}).`);
    await clearTelegramSessionToken();
    setUser(null);
    setBackendSessionUser(null);
    setLoginCompleted(false);
  };

  const deleteCloudAccount = async () => {
    const response = await backendFetch('/user/account', { method: 'DELETE' });
    const data: { error?: string } = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Account deletion failed (${response.status}).`);
    if (isNativePlatform) {
      await TelegramNative.setCloudSyncDisabled({ disabled: true });
      nativeCloudSyncDisabled.current = true;
      setCloudSyncDisabledState(true);
    }
    await clearTelegramSessionToken();
    setBackendSessionUser(null);
    setLoginCompleted(false);
    setCloudSyncConnecting(false);
    nativeAutoConnectUid.current = user?.uid || null;
    nativeLoginRequested.current = false;
    nativeOAuthStarted.current = false;
  };

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      loginCompleted,
      telegramAuthStep,
      cloudSyncEnabled: Boolean(user && backendSessionUser?.uid === user.uid),
      cloudSyncConnecting,
      cloudSyncDisabled,
      authError,
      telegramLoginUrl,
      signInWithTelegram,
      submitTelegramPhoneNumber,
      submitTelegramCode,
      submitTelegramPassword,
      signOut,
      deleteCloudAccount,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
