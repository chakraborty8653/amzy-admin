import React from 'react';
import { X } from 'lucide-react';
import { TelegramChannelConfig } from '../types';

interface ChannelFilterBarProps {
  channels: TelegramChannelConfig[];
  selectedChannelId: string;
  onSelectChannel: (channelId: string) => void;
}

export const ChannelFilterBar: React.FC<ChannelFilterBarProps> = ({
  channels,
  selectedChannelId,
  onSelectChannel,
}) => {
  const isFiltered = selectedChannelId !== 'all';

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 select-none">
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar py-1 flex-1">
          <button
            type="button"
            onClick={() => onSelectChannel('all')}
            aria-pressed={!isFiltered}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 active:scale-95 flex-shrink-0 ${
              !isFiltered
                ? 'bg-white text-black font-bold shadow-md'
                : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/80'
            }`}
          >
            All Channels
          </button>

          {channels.map((channel) => {
            const selected = selectedChannelId === channel.id;
            return (
              <button
                key={channel.id}
                type="button"
                onClick={() => onSelectChannel(selected ? 'all' : channel.id)}
                aria-pressed={selected}
                title={`Videos from ${channel.title || `@${channel.username}`}`}
                className={`max-w-52 truncate px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all duration-200 active:scale-95 flex-shrink-0 ${
                  selected
                    ? 'bg-[#E50914] text-white font-bold shadow-lg shadow-[#E50914]/25'
                    : 'bg-zinc-800/90 hover:bg-zinc-700 text-zinc-300 border border-zinc-700/80'
                }`}
              >
                {channel.title || `@${channel.username}`}
              </button>
            );
          })}
        </div>

        {isFiltered && (
          <button
            type="button"
            onClick={() => onSelectChannel('all')}
            className="flex items-center space-x-1 text-xs text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 rounded-full border border-zinc-700 transition-colors flex-shrink-0"
            title="Show all channels"
            aria-label="Show all channels"
          >
            <X className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        )}
      </div>
    </div>
  );
};
