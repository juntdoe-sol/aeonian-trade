import { useState, useCallback } from 'react';
import { useAuth } from '@pooflabs/web';
import { ChevronDown, ChevronUp, MessageSquare, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useRealtimeData } from '@/hooks/use-realtime-data';
import { subscribeManyBattleMessages, setBattleMessages, type BattleMessagesResponse } from '@/lib/collections/battleMessages';
import { Address } from '@/lib/db-client';
import { truncateAddress } from '@/utils/format-address';

const PRESET_EMOJIS = ['🔥', '💀', '📈', '💸', '🤣', '👑'];

interface TrashTalkSectionProps {
  battleId: string;
}

function formatTimeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function TrashTalkSection({ battleId }: TrashTalkSectionProps) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const { data: allMessages } = useRealtimeData<BattleMessagesResponse[]>(
    subscribeManyBattleMessages,
    true,
  );

  const messages = (allMessages ?? [])
    .filter((m) => m.battleId === battleId)
    .sort((a, b) => a.createdAt - b.createdAt);

  const handleSend = useCallback(async () => {
    if (!user?.address || !text.trim()) return;
    const trimmed = text.trim();
    if (trimmed.length > 100) {
      toast.error('Message too long (max 100 chars)');
      return;
    }
    setSending(true);
    try {
      const success = await setBattleMessages(crypto.randomUUID(), {
        battleId,
        senderAddress: Address.publicKey(user.address),
        text: trimmed,
        emoji: selectedEmoji || undefined,
        createdAt: Math.floor(Date.now() / 1000),
      });
      if (success) {
        setText('');
        setSelectedEmoji(null);
      } else {
        toast.error('Failed to send message');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setSending(false);
    }
  }, [user, text, selectedEmoji, battleId]);

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-4 transition-all hover:bg-white/[0.03]"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <MessageSquare size={15} style={{ color: '#b794f6' }} />
          <span className="text-sm font-bold" style={{ color: '#b794f6' }}>
            Trash Talk
          </span>
          {messages.length > 0 && (
            <span
              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full tabular-nums"
              style={{ background: '#b794f622', color: '#b794f6' }}
            >
              {messages.length}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp size={15} style={{ color: '#8A8A8A' }} />
        ) : (
          <ChevronDown size={15} style={{ color: '#8A8A8A' }} />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Messages */}
          {messages.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: '#5A5A5A' }}>
              No trash talk yet. Be the first!
            </p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className="flex items-start gap-2 glass-inner rounded-lg p-2.5"
                >
                  <span className="text-[10px] font-mono flex-shrink-0 mt-0.5" style={{ color: '#8A8A8A' }}>
                    {truncateAddress(msg.senderAddress, 6, 4)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm break-words leading-snug">
                      {msg.emoji && <span className="mr-1">{msg.emoji}</span>}
                      {msg.text}
                    </p>
                  </div>
                  <span className="text-[10px] flex-shrink-0" style={{ color: '#5A5A5A' }}>
                    {formatTimeAgo(msg.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Input area */}
          {user ? (
            <div className="space-y-2">
              {/* Emoji picker */}
              <div className="flex items-center gap-1.5">
                {PRESET_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => setSelectedEmoji((prev) => (prev === emoji ? null : emoji))}
                    className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-all"
                    style={{
                      background: selectedEmoji === emoji ? 'rgba(183,148,246,0.2)' : 'rgba(255,255,255,0.04)',
                      border: selectedEmoji === emoji ? '1px solid rgba(183,148,246,0.4)' : '1px solid transparent',
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Talk your trash..."
                  maxLength={100}
                  className="glass-input flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-all"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !text.trim()}
                  className="w-9 h-9 rounded-lg flex items-center justify-center transition-all hover:brightness-110 disabled:opacity-40"
                  style={{ background: '#b794f6', color: '#fff' }}
                >
                  {sending ? (
                    <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  ) : (
                    <Send size={15} />
                  )}
                </button>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px]" style={{ color: '#5A5A5A' }}>
                  {text.length}/100
                </span>
              </div>
            </div>
          ) : (
            <div className="text-center py-3">
              <p className="text-xs" style={{ color: '#5A5A5A' }}>
                Log in to trash talk
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
