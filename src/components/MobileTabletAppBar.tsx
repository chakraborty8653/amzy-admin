import React from 'react';
import { Home, Plus, Search, Smile } from 'lucide-react';
import { ActiveTab } from '../types';

interface MobileTabletAppBarProps {
  activeTab: ActiveTab;
  onTabChange: (tab: ActiveTab) => void;
  playlistCount: number;
}

export const MobileTabletAppBar: React.FC<MobileTabletAppBarProps> = ({
  activeTab,
  onTabChange,
  playlistCount,
}) => {
  const tabs = [
    { id: 'home' as const, label: 'Home', icon: Home, selected: activeTab === 'home' },
    { id: 'search' as const, label: 'Search', icon: Search, selected: activeTab === 'search' },
    { id: 'mylist' as const, label: 'Plus', icon: Plus, selected: activeTab === 'mylist' },
    { id: 'profile' as const, label: 'My Profile', icon: Smile, selected: activeTab === 'profile' },
  ];

  return (
    <aside
      aria-label="Mobile and Tablet App Bar"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center pl-[max(1rem,env(safe-area-inset-left,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] select-none xl:hidden"
    >
      <nav className="pointer-events-auto flex h-[68px] w-full max-w-[860px] items-center rounded-full border-2 border-[#484848] bg-[#292929]/95 p-1.5 shadow-[0_8px_28px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:w-[82%]">
        {tabs.map(({ id, label, icon: Icon, selected }) => (
          <button
            key={id}
            type="button"
            onClick={() => onTabChange(id)}
            aria-current={selected ? 'page' : undefined}
            className={`group flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-full transition-colors active:scale-95 ${
              selected ? 'bg-[#383838] text-white' : 'text-[#bcbcbc] hover:text-white'
            }`}
          >
            <span className="relative flex h-9 w-9 items-center justify-center">
              {id === 'profile' ? (
                <span className={`flex h-8 w-8 items-center justify-center rounded-[12px] bg-gradient-to-b from-sky-400 to-blue-600 text-white shadow-sm ${
                  selected ? 'ring-2 ring-white/15' : ''
                }`}>
                  <Icon className="h-6 w-6" strokeWidth={2} />
                </span>
              ) : (
                <Icon
                  className={`h-7 w-7 transition-transform group-hover:scale-105 ${
                    selected ? 'text-white' : ''
                  }`}
                  strokeWidth={selected ? 2.3 : 2}
                />
              )}
              {selected && (
                <span className="absolute bottom-0 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-[#E50914] shadow-[0_0_8px_#E50914]" />
              )}
              {id === 'mylist' && playlistCount > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-[#292929] bg-[#E50914] px-1 text-[9px] font-bold text-white">
                  {playlistCount > 99 ? '99+' : playlistCount}
                </span>
              )}
            </span>
            <span className={`max-w-full truncate px-1 text-[11px] font-semibold leading-tight sm:text-xs ${
              selected ? 'text-white' : 'text-[#bcbcbc]'
            }`}>
              {label}
            </span>
          </button>
        ))}
      </nav>
    </aside>
  );
};
