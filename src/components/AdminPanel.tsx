import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  Film,
  LayoutDashboard,
  LoaderCircle,
  LogIn,
  LogOut,
  Pencil,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminBackendFetch } from '../services/backendApi';
import { getAdminAuthClient } from '../services/adminSupabase';

type AdminSection = 'overview' | 'users' | 'data' | 'notifications';

interface DatasetSummary {
  name: string;
  label: string;
  count: number;
}

interface DatasetPage {
  table: string;
  label: string;
  total: number;
  page: number;
  pageSize: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
}

interface AdminUser {
  id: number;
  uid: string;
  email: string | null;
  displayName: string | null;
  photoUrl: string | null;
  telegramId: string | null;
  username: string | null;
  phoneNumber: string | null;
  createdAt: string | null;
  channelCount: number;
  favoriteCount: number;
}

interface AdminChannel {
  id: number;
  title: string;
  channelUsername: string;
  channelLink: string | null;
  createdAt: string | null;
}

interface AdminNotification {
  id: string;
  title: string;
  message: string;
  isPublished: boolean;
  createdAt: string;
}

interface UserPage {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
}

let adminSessionRefresh: ReturnType<SupabaseClient['auth']['refreshSession']> | null = null;

async function readError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (response.status === 401) {
    return 'Admin API ne valid Supabase login accept nahi kiya. Hosted setup mein teleflix-api deploy karein; local setup mein server .env allowlist check karein.';
  }
  if (response.status === 403) return 'Is email ko admin access allow nahi hai.';
  return payload.error || 'Request complete nahi ho saki. Dobara try karein.';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

function formatDatasetValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (error) {
      console.error('Could not render a Supabase data value:', error);
      return '[unavailable]';
    }
  }
  return String(value);
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back to the selection-based copy path when clipboard permission is unavailable.
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('Clipboard copy was denied.');
  } finally {
    textarea.remove();
  }
}

export function AdminPanel() {
  const authClient = getAdminAuthClient();
  const [authLoading, setAuthLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authConfigError, setAuthConfigError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [section, setSection] = useState<AdminSection>('overview');
  const [usersPage, setUsersPage] = useState<UserPage | null>(null);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userChannels, setUserChannels] = useState<AdminChannel[]>([]);
  const [userChannelsLoading, setUserChannelsLoading] = useState(false);
  const [userChannelsError, setUserChannelsError] = useState<string | null>(null);
  const [userChannelsCopyError, setUserChannelsCopyError] = useState<string | null>(null);
  const [copiedUserChannel, setCopiedUserChannel] = useState<number | 'all' | null>(null);
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [selectedDataset, setSelectedDataset] = useState('');
  const [datasetPage, setDatasetPage] = useState<DatasetPage | null>(null);
  const [datasetPageLoading, setDatasetPageLoading] = useState(false);
  const [datasetPageNumber, setDatasetPageNumber] = useState(1);
  const [datasetSearch, setDatasetSearch] = useState('');
  const [copiedCell, setCopiedCell] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [editingNotificationId, setEditingNotificationId] = useState<string | null>(null);
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (!authClient) {
      setAuthConfigError('Admin login configure nahi hai. VITE_SUPABASE_URL aur VITE_SUPABASE_ANON_KEY set karein.');
      setAuthLoading(false);
      return;
    }

    let active = true;
    const applySession = (session: { access_token: string; user: { email?: string } } | null) => {
      setAccessToken(session?.access_token || null);
      setAuthEmail(session?.user.email || null);
      setAuthLoading(false);
    };
    const { data: { subscription } } = authClient.auth.onAuthStateChange((_event, session) => {
      if (active) applySession(session);
    });
    void authClient.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) {
        setSignInError(error.message);
        applySession(null);
        return;
      }
      applySession(data.session);
    }).catch((error: unknown) => {
      if (!active) return;
      setSignInError(error instanceof Error ? error.message : 'Supabase Auth session read nahi ho saki.');
      applySession(null);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [authClient]);

  const signIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!authClient) return;
    setSigningIn(true);
    setSignInError(null);
    try {
      const { error } = await authClient.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword('');
    } catch (error) {
      setSignInError(error instanceof Error ? error.message : 'Supabase sign in nahi ho saka.');
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    if (!authClient) return;
    const { error } = await authClient.auth.signOut();
    if (error) {
      setSignInError(error.message);
      return;
    }
    setUsersPage(null);
    setDatasets([]);
    setDatasetPage(null);
    setNotifications([]);
    setSelectedUser(null);
    setUserChannels([]);
  };

  const requestAdmin = useCallback(async (path: string, init: RequestInit = {}) => {
    if (!authClient || !accessToken) throw new Error('Supabase Auth sign-in required.');
    const response = await adminBackendFetch(path, accessToken, init);
    if (response.status !== 401) return response;

    const { data: authData, error: authError } = await authClient.auth.getUser(accessToken);
    if (!authError && authData.user) {
      return response;
    }

    if (!adminSessionRefresh) adminSessionRefresh = authClient.auth.refreshSession();
    const refreshPromise = adminSessionRefresh;
    try {
      const { data, error } = await refreshPromise;
      if (error || !data.session) {
        setAccessToken(null);
        setAuthEmail(null);
        setSignInError('Supabase Auth session expire ho gayi. Dobara sign in karein.');
        return response;
      }

      setAccessToken(data.session.access_token);
      setAuthEmail(data.session.user.email || null);
      const retry = await adminBackendFetch(path, data.session.access_token, init);
      return retry;
    } finally {
      if (adminSessionRefresh === refreshPromise) adminSessionRefresh = null;
    }
  }, [accessToken, authClient]);

  const loadUsers = useCallback(async () => {
    if (!accessToken) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: '20',
        search: userSearch.trim(),
      });
      const response = await requestAdmin(`/admin/users?${params.toString()}`);
      if (!response.ok) throw new Error(await readError(response));
      setUsersPage(await response.json() as UserPage);
    } catch (error) {
      setUsersError(error instanceof Error ? error.message : 'Users load nahi ho sake.');
    } finally {
      setUsersLoading(false);
    }
  }, [page, requestAdmin, userSearch]);

  const openUserChannels = async (user: AdminUser) => {
    setSelectedUser(user);
    setUserChannels([]);
    setUserChannelsLoading(true);
    setUserChannelsError(null);
    setUserChannelsCopyError(null);
    setCopiedUserChannel(null);
    try {
      const response = await requestAdmin(`/admin/users/${user.id}/channels`);
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { channels: AdminChannel[] };
      setUserChannels(data.channels);
    } catch (error) {
      setUserChannelsError(error instanceof Error ? error.message : 'User ke channel links load nahi ho sake.');
    } finally {
      setUserChannelsLoading(false);
    }
  };

  const copyUserChannel = async (channelId: number | 'all', text: string) => {
    try {
      await copyTextToClipboard(text);
      setCopiedUserChannel(channelId);
      setUserChannelsCopyError(null);
      window.setTimeout(() => setCopiedUserChannel((current) => current === channelId ? null : current), 1500);
    } catch (error) {
      console.error('Could not copy user Telegram channel link:', error);
      setUserChannelsCopyError('Link copy nahi hua. Browser clipboard permission check karke dobara try karein.');
    }
  };

  const loadNotifications = useCallback(async () => {
    if (!accessToken) return;
    setNotificationsLoading(true);
    setNotificationsError(null);
    try {
      const response = await requestAdmin('/admin/notifications');
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { notifications: AdminNotification[] };
      setNotifications(data.notifications);
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : 'Notifications load nahi ho sakin.');
    } finally {
      setNotificationsLoading(false);
    }
  }, [requestAdmin]);

  const loadDatabase = useCallback(async () => {
    if (!accessToken) return;
    setDatabaseLoading(true);
    setDatabaseError(null);
    try {
      const response = await requestAdmin('/admin/data');
      if (!response.ok) throw new Error(await readError(response));
      const data = await response.json() as { tables: DatasetSummary[] };
      setDatasets(data.tables);
      setSelectedDataset((current) => current || data.tables[0]?.name || '');
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : 'Supabase tables load nahi ho sakin.');
    } finally {
      setDatabaseLoading(false);
    }
  }, [requestAdmin]);

  const loadDatasetPage = useCallback(async () => {
    if (!accessToken || !selectedDataset) return;
    setDatasetPageLoading(true);
    setDatasetPage(null);
    setDatabaseError(null);
    try {
      const params = new URLSearchParams({
        table: selectedDataset,
        page: String(datasetPageNumber),
        pageSize: '20',
        search: datasetSearch.trim(),
      });
      const response = await requestAdmin(`/admin/data?${params.toString()}`);
      if (!response.ok) throw new Error(await readError(response));
      setDatasetPage(await response.json() as DatasetPage);
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : 'Supabase data load nahi ho saka.');
    } finally {
      setDatasetPageLoading(false);
    }
  }, [requestAdmin, selectedDataset, datasetPageNumber, datasetSearch]);

  useEffect(() => {
    if (authLoading || !accessToken) return;
    const timer = window.setTimeout(() => void loadUsers(), userSearch ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, accessToken, loadUsers, userSearch]);

  useEffect(() => {
    if (!authLoading && accessToken) void loadDatabase();
  }, [authLoading, accessToken, loadDatabase]);

  useEffect(() => {
    if (authLoading || !accessToken || !selectedDataset) return;
    const timer = window.setTimeout(() => void loadDatasetPage(), datasetSearch ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, accessToken, loadDatasetPage, datasetSearch, selectedDataset]);

  useEffect(() => {
    if (!authLoading && accessToken) void loadNotifications();
  }, [authLoading, accessToken, loadNotifications]);

  const publishNotification = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPublishing(true);
    setNotificationsError(null);
    try {
      const response = await requestAdmin(
        editingNotificationId ? `/admin/notifications/${encodeURIComponent(editingNotificationId)}` : '/admin/notifications',
        {
          method: editingNotificationId ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, message }),
        },
      );
      if (!response.ok) throw new Error(await readError(response));
      setTitle('');
      setMessage('');
      setEditingNotificationId(null);
      await loadNotifications();
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : 'Notification save nahi hui.');
    } finally {
      setPublishing(false);
    }
  };

  const editNotification = (notification: AdminNotification) => {
    setEditingNotificationId(notification.id);
    setTitle(notification.title);
    setMessage(notification.message);
    setNotificationsError(null);
  };

  const cancelNotificationEdit = () => {
    setEditingNotificationId(null);
    setTitle('');
    setMessage('');
    setNotificationsError(null);
  };

  const deleteNotification = async (notification: AdminNotification) => {
    if (!window.confirm(`"${notification.title}" notification delete karein?`)) return;
    setDeletingNotificationId(notification.id);
    setNotificationsError(null);
    try {
      const response = await requestAdmin(`/admin/notifications/${encodeURIComponent(notification.id)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(await readError(response));
      if (editingNotificationId === notification.id) cancelNotificationEdit();
      await loadNotifications();
    } catch (error) {
      setNotificationsError(error instanceof Error ? error.message : 'Notification delete nahi hui.');
    } finally {
      setDeletingNotificationId(null);
    }
  };

  const copyDatasetCell = async (key: string, value: string) => {
    try {
      await copyTextToClipboard(value);
      setCopiedCell(key);
      setCopyError(null);
      window.setTimeout(() => setCopiedCell((current) => current === key ? null : current), 1500);
    } catch (error) {
      console.error('Could not copy Supabase data value:', error);
      setCopyError('Text copy nahi hua. Browser clipboard permission check karke dobara try karein.');
    }
  };

  const navigateSection = (nextSection: AdminSection) => {
    setSection(nextSection);
    if (nextSection !== 'users') {
      setUserSearch('');
      setPage(1);
    }
  };

  const openDataset = (name: string) => {
    setSelectedDataset(name);
    setDatasetPageNumber(1);
    setDatasetSearch('');
    navigateSection('data');
  };

  if (authLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#08090b] text-zinc-300">
        <LoaderCircle className="h-7 w-7 animate-spin text-[#E50914]" />
      </div>
    );
  }

  if (!accessToken) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#08090b] px-5 text-white select-text">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-[#111318] p-8 shadow-2xl">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#E50914]/15 text-[#E50914]">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <p className="mt-6 text-center font-bebas text-3xl tracking-widest text-[#E50914]">AMZY CONTROL</p>
          <h1 className="mt-2 text-center text-xl font-bold">Admin sign in</h1>
          <p className="mt-2 text-center text-sm leading-6 text-zinc-400">
            Supabase Auth email se sign in karein. Access sirf allowlisted admin emails ko milega.
          </p>
          {authConfigError && <p className="mt-5 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs leading-5 text-amber-200">{authConfigError}</p>}
          {signInError && <p className="mt-4 text-sm text-red-300">{signInError}</p>}
          <form onSubmit={(event) => void signIn(event)} className="mt-6 space-y-3">
            <label className="block text-left text-xs font-semibold text-zinc-400">
              Email
              <input
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none focus:border-[#E50914]/60"
              />
            </label>
            <label className="block text-left text-xs font-semibold text-zinc-400">
              Password
              <input
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none focus:border-[#E50914]/60"
              />
            </label>
            <button
              type="submit"
              disabled={!authClient || signingIn}
              className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#E50914] px-5 py-3 text-sm font-bold transition hover:bg-[#b81d24] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {signingIn ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              {signingIn ? 'Signing in…' : 'Supabase se sign in'}
            </button>
          </form>
        </section>
      </main>
    );
  }

  const navItems: Array<{ id: AdminSection; label: string; icon: typeof LayoutDashboard }> = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'users', label: 'Users', icon: Users },
    { id: 'data', label: 'Supabase data', icon: Database },
    { id: 'notifications', label: 'Notifications', icon: Bell },
  ];
  const pageCount = Math.max(1, Math.ceil((usersPage?.total || 0) / (usersPage?.pageSize || 20)));
  const datasetPageCount = Math.max(1, Math.ceil((datasetPage?.total || 0) / (datasetPage?.pageSize || 20)));
  const databaseRowCount = datasets.reduce((total, dataset) => total + dataset.count, 0);

  return (
    <div className="min-h-screen bg-[#08090b] text-zinc-100 select-text">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-white/[0.07] bg-[#0c0d10] p-5 lg:flex">
        <a href="/" className="flex items-center gap-3 px-2 py-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#E50914]"><Film className="h-5 w-5" /></span>
          <span><span className="block font-bebas text-2xl tracking-widest text-white">AMZY</span><span className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Control center</span></span>
        </a>
        <nav className="mt-10 space-y-2">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" onClick={() => navigateSection(id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium transition ${section === id ? 'bg-[#E50914]/15 text-white' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'}`}>
              <Icon className={`h-4 w-4 ${section === id ? 'text-[#E50914]' : ''}`} /> {label}
            </button>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300"><Activity className="h-3.5 w-3.5" /> Backend protected</div>
          <p className="mt-2 break-all text-[10px] text-zinc-600">{authEmail}</p>
        </div>
      </aside>

      <main className="min-h-screen lg:ml-64">
        <header className="sticky top-0 z-10 flex min-h-16 items-center justify-between border-b border-white/[0.07] bg-[#08090b]/90 px-5 backdrop-blur-xl sm:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E50914]/15 text-[#E50914] lg:hidden"><ShieldCheck className="h-5 w-5" /></span>
            <span className="font-semibold">{section === 'data' ? 'Supabase data explorer' : navItems.find((item) => item.id === section)?.label}</span>
          </div>
            <div className="flex items-center gap-3">
              <span className="hidden max-w-56 truncate text-xs text-zinc-500 sm:block">{authEmail}</span>
              <button type="button" onClick={() => void signOut()} className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 transition hover:text-white">
                <LogOut className="h-4 w-4" /> Sign out
              </button>
              <a href="/" className="hidden text-xs font-medium text-zinc-500 transition hover:text-white sm:block">← App par wapas</a>
            </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-9">
          <div className="mb-7 lg:hidden">
            <nav className="flex gap-2 overflow-x-auto">
              {navItems.map(({ id, label, icon: Icon }) => (
                <button key={id} type="button" onClick={() => navigateSection(id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-semibold ${section === id ? 'bg-[#E50914] text-white' : 'bg-white/5 text-zinc-400'}`}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </nav>
          </div>

          <div className="mb-8">
            <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[#E50914]">AMZY / Administration</p>
            <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
              {section === 'overview' ? 'Dashboard overview' : section === 'users' ? 'User directory' : 'App notifications'}
            </h1>
            <p className="mt-1 text-sm text-zinc-500">
              {section === 'overview' ? 'App users aur announcements ka live snapshot.' : section === 'users' ? 'User profiles aur unki app activity summary.' : 'Announcement publish karein — app ke users ko dikhai jayegi.'}
            </p>
          </div>

          {usersError && (section === 'overview' || section === 'users') && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-4 text-sm text-red-200">
              <CircleAlert className="h-4 w-4 shrink-0" /> {usersError}
              <button type="button" onClick={() => void loadUsers()} className="ml-auto underline">Retry</button>
            </div>
          )}
          {databaseError && section === 'data' && (
            <div className="mb-5 flex items-center gap-2 rounded-xl border border-red-500/20 bg-red-500/[0.07] p-4 text-sm text-red-200">
              <CircleAlert className="h-4 w-4 shrink-0" /> {databaseError}
              <button type="button" onClick={() => { void loadDatabase(); void loadDatasetPage(); }} className="ml-auto underline">Retry</button>
            </div>
          )}

          {section === 'overview' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <article className="rounded-2xl border border-white/[0.07] bg-[#111318] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-500">Registered users</span>
                    <span className="rounded-xl bg-sky-400/10 p-2 text-sky-300"><Users className="h-4 w-4" /></span>
                  </div>
                  <p className="mt-5 text-3xl font-semibold">{usersLoading && !usersPage ? '…' : (usersPage?.total ?? '—')}</p>
                  <p className="mt-1 text-xs text-zinc-600">Cloud accounts in AMZY</p>
                </article>
                <article className="rounded-2xl border border-white/[0.07] bg-[#111318] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-500">Recent announcements</span>
                    <span className="rounded-xl bg-amber-400/10 p-2 text-amber-300"><Bell className="h-4 w-4" /></span>
                  </div>
                  <p className="mt-5 text-3xl font-semibold">{notificationsLoading && !notifications.length ? '…' : notifications.length}</p>
                  <p className="mt-1 text-xs text-zinc-600">Most recent 50 published messages</p>
                </article>
                <article className="rounded-2xl border border-white/[0.07] bg-[#111318] p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-zinc-500">Saved Supabase rows</span>
                    <span className="rounded-xl bg-violet-400/10 p-2 text-violet-300"><Database className="h-4 w-4" /></span>
                  </div>
                  <p className="mt-5 text-3xl font-semibold">{databaseLoading && !datasets.length ? '…' : databaseRowCount}</p>
                  <p className="mt-1 text-xs text-zinc-600">Across {datasets.length} app data tables</p>
                </article>
              </div>
              <section className="mt-6 rounded-2xl border border-white/[0.07] bg-[#111318] p-5 sm:p-6">
                <div className="mb-4"><h2 className="font-semibold">Supabase tables</h2><p className="mt-1 text-xs text-zinc-500">Open a table to browse its saved records.</p></div>
                {databaseError && <p className="mb-3 text-xs text-red-300">{databaseError}</p>}
                {databaseLoading && !datasets.length ? (
                  <LoaderCircle className="mx-auto my-8 h-5 w-5 animate-spin text-zinc-500" />
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {datasets.map((dataset) => (
                      <button key={dataset.name} type="button" onClick={() => openDataset(dataset.name)} className="flex items-center justify-between rounded-xl border border-white/[0.06] bg-black/20 p-4 text-left transition hover:border-[#E50914]/40 hover:bg-white/[0.03]">
                        <span className="flex items-center gap-3"><Database className="h-4 w-4 text-zinc-500" /><span className="text-xs font-medium text-zinc-300">{dataset.label}</span></span>
                        <span className="text-sm font-semibold text-white">{dataset.count.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
              <section className="mt-6 rounded-2xl border border-white/[0.07] bg-[#111318] p-5 sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <div><h2 className="font-semibold">Recently joined</h2><p className="mt-1 text-xs text-zinc-500">Latest registered app users</p></div>
                  <button type="button" onClick={() => navigateSection('users')} className="text-xs font-semibold text-[#ff7077] hover:text-white">All users →</button>
                </div>
                <UserTable users={usersPage?.users.slice(0, 5) || []} loading={usersLoading} onSelectUser={(user) => void openUserChannels(user)} />
              </section>
              <section className="mt-5 flex flex-col gap-4 rounded-2xl border border-[#E50914]/20 bg-gradient-to-br from-[#E50914]/10 to-transparent p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
                <div><h2 className="font-semibold">Send an app-wide update</h2><p className="mt-1 text-xs text-zinc-400">Publish an announcement for users in AMZY.</p></div>
                <button type="button" onClick={() => navigateSection('notifications')} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#E50914] px-4 py-2.5 text-xs font-bold hover:bg-[#b81d24]"><Send className="h-3.5 w-3.5" /> Compose</button>
              </section>
            </>
          )}

          {section === 'users' && (
            <section className="rounded-2xl border border-white/[0.07] bg-[#111318] p-4 sm:p-6">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <p className="text-sm text-zinc-400">{usersPage?.total ?? 0} users <span className="text-zinc-700">/</span> profile and activity details</p>
                <label className="relative block sm:w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                  <input value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setPage(1); }} placeholder="Search name, username, email…" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-[#E50914]/60" />
                </label>
              </div>
              <UserTable users={usersPage?.users || []} loading={usersLoading} onSelectUser={(user) => void openUserChannels(user)} />
              <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs text-zinc-500">
                <span>Page {page} of {pageCount}</span>
                <div className="flex gap-2">
                  <button type="button" aria-label="Previous page" disabled={page <= 1 || usersLoading} onClick={() => setPage((value) => value - 1)} className="rounded-lg border border-white/10 p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" aria-label="Next page" disabled={page >= pageCount || usersLoading} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-white/10 p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </section>
          )}

          {section === 'data' && (
            <section className="rounded-2xl border border-white/[0.07] bg-[#111318] p-4 sm:p-6">
              <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(180px,1fr)_minmax(220px,320px)]">
                <label className="text-xs font-semibold text-zinc-500">
                  Supabase table
                  <select value={selectedDataset} onChange={(event) => { setSelectedDataset(event.target.value); setDatasetPageNumber(1); }} className="mt-2 w-full rounded-xl border border-white/10 bg-[#0b0c0f] px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-[#E50914]/60">
                    {datasets.map((dataset) => <option key={dataset.name} value={dataset.name}>{dataset.label} ({dataset.count.toLocaleString()})</option>)}
                  </select>
                </label>
                <label className="relative block self-end">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
                  <input value={datasetSearch} onChange={(event) => { setDatasetSearch(event.target.value); setDatasetPageNumber(1); }} placeholder="Search in selected table…" className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-9 pr-3 text-xs text-white outline-none placeholder:text-zinc-600 focus:border-[#E50914]/60" />
                </label>
              </div>
              <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
                <span>{datasetPage?.label || 'Supabase records'} · {(datasetPage?.total ?? 0).toLocaleString()} rows</span>
                <span>Credential hashes and device keys are hidden; room codes are masked. Select or copy cell text.</span>
              </div>
              {copyError && <p role="alert" className="mb-3 text-xs text-red-300">{copyError}</p>}
              {datasetPageLoading && !datasetPage ? (
                <div className="flex justify-center py-14"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-500" /></div>
              ) : datasetPage?.rows.length ? (
                <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
                  <table className="w-full min-w-max border-collapse text-left">
                    <thead><tr className="border-b border-white/[0.06] text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
                      {datasetPage.columns.map((column) => <th key={column} className="whitespace-nowrap px-3 py-3">{column === 'channelLink' ? 'Channel link' : column === 'userIds' ? 'User IDs' : column === 'userCount' ? 'User count' : column.replace(/_/g, ' ')}</th>)}
                    </tr></thead>
                    <tbody>
                      {datasetPage.rows.map((row, rowIndex) => {
                        const rowKey = String(row.id ?? row.uid ?? row.code ?? `${datasetPage.table}-${rowIndex}`);
                        return (
                          <tr key={`${rowKey}-${rowIndex}`} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
                            {datasetPage.columns.map((column) => {
                              const formattedValue = formatDatasetValue(row[column]);
                              const value = datasetPage.table === 'channels'
                                && column === 'channelLink'
                                && formattedValue === '—'
                                ? 'Original link not saved'
                                : formattedValue;
                              const cellKey = `${rowKey}-${column}-${rowIndex}`;
                              const channelLink = datasetPage.table === 'channels'
                                && column === 'channelLink'
                                && value !== '—'
                                && value !== 'Original link not saved';
                              return (
                                <td key={column} title={value} className="max-w-[280px] whitespace-pre-wrap break-words px-3 py-3 align-top text-[11px] leading-5 text-zinc-400 select-text">
                                  <div className="flex items-start gap-2">
                                    {channelLink ? (
                                      <a href={value} target="_blank" rel="noopener noreferrer" className="break-all text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200">{value}</a>
                                    ) : <span className="select-text">{value}</span>}
                                    {value !== '—' && value !== 'Original link not saved' && (
                                      <button type="button" aria-label={`Copy ${column}`} title={copiedCell === cellKey ? 'Copied' : `Copy ${column}`} onClick={() => void copyDatasetCell(cellKey, value)} className="shrink-0 rounded p-1 text-zinc-600 hover:bg-white/5 hover:text-zinc-200">
                                        {copiedCell === cellKey ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="py-12 text-center text-xs text-zinc-600">{datasetPageLoading ? 'Loading records…' : 'Is table mein koi record nahi mila.'}</p>
              )}
              <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4 text-xs text-zinc-500">
                <span>Page {datasetPageNumber} of {datasetPageCount}</span>
                <div className="flex gap-2">
                  <button type="button" aria-label="Previous data page" disabled={datasetPageNumber <= 1 || datasetPageLoading} onClick={() => setDatasetPageNumber((value) => value - 1)} className="rounded-lg border border-white/10 p-2 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" aria-label="Next data page" disabled={datasetPageNumber >= datasetPageCount || datasetPageLoading} onClick={() => setDatasetPageNumber((value) => value + 1)} className="rounded-lg border border-white/10 p-2 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            </section>
          )}

          {section === 'notifications' && (
            <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
              <form onSubmit={(event) => void publishNotification(event)} className="rounded-2xl border border-white/[0.07] bg-[#111318] p-5 sm:p-6">
                <div className="mb-5 flex items-center gap-3">
                  <span className="rounded-xl bg-[#E50914]/15 p-2.5 text-[#ff6068]"><Send className="h-4 w-4" /></span>
                  <div><h2 className="font-semibold">{editingNotificationId ? 'Edit announcement' : 'New announcement'}</h2><p className="mt-1 text-xs text-zinc-500">Visible in the app notifications area.</p></div>
                </div>
                <label className="mb-4 block text-xs font-semibold text-zinc-400">
                  Title <span className="text-zinc-600">({title.length}/120)</span>
                  <input required maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. New update available" className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-[#E50914]/60" />
                </label>
                <label className="block text-xs font-semibold text-zinc-400">
                  Message <span className="text-zinc-600">({message.length}/2000)</span>
                  <textarea required maxLength={2000} rows={6} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Write an update for your users…" className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3.5 py-3 text-sm leading-6 text-white outline-none placeholder:text-zinc-600 focus:border-[#E50914]/60" />
                </label>
                {notificationsError && <p className="mt-3 text-xs text-red-300">{notificationsError}</p>}
                <button type="submit" disabled={publishing || !title.trim() || !message.trim()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#E50914] px-4 py-3 text-sm font-bold transition hover:bg-[#b81d24] disabled:cursor-not-allowed disabled:opacity-50">
                  {publishing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {publishing ? (editingNotificationId ? 'Saving…' : 'Publishing…') : (editingNotificationId ? 'Save changes' : 'Publish announcement')}
                </button>
                {editingNotificationId && (
                  <button type="button" onClick={cancelNotificationEdit} disabled={publishing} className="mt-2 w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white disabled:opacity-50">
                    Cancel edit
                  </button>
                )}
              </form>

              <section className="rounded-2xl border border-white/[0.07] bg-[#111318] p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div><h2 className="font-semibold">Recent announcements</h2><p className="mt-1 text-xs text-zinc-500">Latest 50 messages</p></div>
                  <Bell className="h-4 w-4 text-zinc-600" />
                </div>
                {notificationsError && <p className="mb-3 text-xs text-red-300">{notificationsError}</p>}
                <div className="space-y-3">
                  {notificationsLoading && !notifications.length ? <LoaderCircle className="mx-auto my-8 h-5 w-5 animate-spin text-zinc-500" /> : notifications.length ? notifications.map((notification) => (
                    <article key={notification.id} className="rounded-xl border border-white/[0.06] bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold">{notification.title}</h3>
                          <time className="mt-1 block text-[10px] text-zinc-600">{formatDate(notification.createdAt)}</time>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button type="button" aria-label={`Edit ${notification.title}`} onClick={() => editNotification(notification)} className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white"><Pencil className="h-3.5 w-3.5" /></button>
                          <button type="button" aria-label={`Delete ${notification.title}`} disabled={deletingNotificationId === notification.id} onClick={() => void deleteNotification(notification)} className="rounded-lg p-2 text-zinc-500 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50">
                            {deletingNotificationId === notification.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-400">{notification.message}</p>
                    </article>
                  )) : <p className="py-8 text-center text-xs text-zinc-600">Abhi tak koi announcement nahi hai.</p>}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="user-channels-title" className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#111318] shadow-2xl">
            <header className="flex items-start justify-between gap-4 border-b border-white/[0.07] p-5 sm:p-6">
              <div className="min-w-0">
                <h2 id="user-channels-title" className="truncate text-lg font-semibold text-white">{selectedUser.displayName || 'Telegram user'} · Channels</h2>
                <p className="mt-1 text-xs text-zinc-500">
                  {userChannelsLoading || userChannelsError ? selectedUser.channelCount : userChannels.length} channels
                  {!userChannelsLoading && !userChannelsError && ` · ${userChannels.filter((channel) => channel.channelLink).length} original links saved`}
                </p>
              </div>
              <button type="button" aria-label="Close channel links" onClick={() => setSelectedUser(null)} className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="max-h-[calc(85vh-90px)] overflow-y-auto p-5 sm:p-6">
              {userChannelsCopyError && <p role="alert" className="mb-3 text-xs text-red-300">{userChannelsCopyError}</p>}
              <div className="mb-4 flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">Telegram channel links saved for this user</p>
                <button
                  type="button"
                  disabled={userChannelsLoading || !userChannels.some((channel) => channel.channelLink)}
                  onClick={() => void copyUserChannel('all', userChannels.flatMap((channel) => channel.channelLink ? [channel.channelLink] : []).join('\n'))}
                  className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {copiedUserChannel === 'all' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedUserChannel === 'all' ? 'Copied all' : 'Copy all links'}
                </button>
              </div>
              {userChannelsLoading ? (
                <div className="flex justify-center py-12"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-500" /></div>
              ) : userChannelsError ? (
                <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/[0.07] p-4 text-sm text-red-200">{userChannelsError}</p>
              ) : userChannels.length ? (
                <ul className="space-y-3">
                  {userChannels.map((channel) => (
                    <li key={channel.id} className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-zinc-200">{channel.title || channel.channelUsername || 'Untitled channel'}</p>
                          <p className="mt-1 text-[10px] text-zinc-600">{channel.channelUsername ? `@${channel.channelUsername.replace(/^@/, '')}` : 'Telegram channel'}</p>
                          {channel.channelLink ? (
                            <a href={channel.channelLink} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-xs text-sky-300 underline decoration-sky-300/40 underline-offset-2 hover:text-sky-200">{channel.channelLink}</a>
                          ) : (
                            <p className="mt-2 text-xs text-amber-300/80">Original link not saved</p>
                          )}
                        </div>
                        {channel.channelLink && (
                          <button type="button" aria-label={`Copy link for ${channel.title || channel.channelUsername}`} title={copiedUserChannel === channel.id ? 'Copied' : 'Copy link'} onClick={() => { if (channel.channelLink) void copyUserChannel(channel.id, channel.channelLink); }} className="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-zinc-200">
                            {copiedUserChannel === channel.id ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="py-12 text-center text-xs text-zinc-600">Is user ke koi saved channels nahi hain.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function UserTable({ users, loading, onSelectUser }: { users: AdminUser[]; loading: boolean; onSelectUser: (user: AdminUser) => void }) {
  if (loading && !users.length) {
    return <div className="flex justify-center py-14"><LoaderCircle className="h-5 w-5 animate-spin text-zinc-500" /></div>;
  }
  if (!users.length) return <p className="py-12 text-center text-xs text-zinc-600">Koi user nahi mila.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[790px] border-collapse text-left">
        <thead><tr className="border-b border-white/[0.06] text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
          <th className="px-3 py-3">User</th><th className="px-3 py-3">Telegram</th><th className="px-3 py-3">Phone</th><th className="px-3 py-3">Activity</th><th className="px-3 py-3">Joined</th>
        </tr></thead>
        <tbody>
          {users.map((adminUser) => (
            <tr key={adminUser.id} className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]">
              <td className="px-3 py-3.5">
                <div className="flex items-center gap-3">
                  {adminUser.photoUrl ? <img src={adminUser.photoUrl} alt="" className="h-9 w-9 rounded-xl object-cover" /> : <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-xs font-bold text-zinc-400">{(adminUser.displayName || adminUser.email || '?').slice(0, 1).toUpperCase()}</span>}
                  <button type="button" onClick={() => onSelectUser(adminUser)} className="min-w-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E50914]">
                    <span className="block max-w-48 truncate text-xs font-semibold text-zinc-200 hover:text-white">{adminUser.displayName || 'Telegram user'}</span>
                    <span className="block max-w-48 truncate text-[10px] text-zinc-600">{adminUser.email || 'Personal email not provided'}</span>
                  </button>
                </div>
              </td>
              <td className="px-3 py-3.5 text-xs text-zinc-400">{adminUser.username ? `@${adminUser.username}` : adminUser.telegramId || '—'}<span className="block text-[10px] text-zinc-700">{adminUser.uid}</span></td>
              <td className="px-3 py-3.5 text-xs text-zinc-500">{adminUser.phoneNumber || '—'}</td>
              <td className="px-3 py-3.5 text-xs text-zinc-400">
                <button type="button" onClick={() => onSelectUser(adminUser)} aria-label={`View ${adminUser.channelCount} channels for ${adminUser.displayName || 'Telegram user'}`} className="text-left hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#E50914]">
                  {adminUser.channelCount} channels<span className="block text-[10px] text-[#ff7077]">View channel links</span>
                </button>
                <span className="block text-[10px] text-zinc-600">{adminUser.favoriteCount} favorites</span>
              </td>
              <td className="px-3 py-3.5 text-xs text-zinc-500">{formatDate(adminUser.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
