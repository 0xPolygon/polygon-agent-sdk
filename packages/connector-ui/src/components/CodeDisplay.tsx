import { Copy, Check, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

interface CodeDisplayProps {
  code: string;
  walletAddress: string;
  totalUsd: number | null;
  onContinue: () => void;
  onRegenerate: () => void;
}

export function CodeDisplay({ code, walletAddress, totalUsd, onRegenerate }: CodeDisplayProps) {
  const [copied, setCopied] = useState(false);
  const [seconds, setSeconds] = useState(300); // matches relay 5-min TTL

  const displayCode = `${code.slice(0, 3)} - ${code.slice(3)}`;

  const shortAddr = walletAddress ? `${walletAddress.slice(0, 6)}..${walletAddress.slice(-4)}` : '';

  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, []);

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  function handleCopy() {
    navigator.clipboard.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div
      className="bg-white rounded-3xl border border-[#c8cfe1] w-full max-w-sm mx-auto overflow-hidden"
      style={{ boxShadow: '0 2px 8px rgba(20,22,53,0.06), 0 16px 48px rgba(20,22,53,0.08)' }}
    >
      {/* Wallet chip header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-[#c8cfe1]">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#7c3aed] to-[#a78bfa] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-mono font-bold text-[#141635] truncate">{shortAddr}</div>
          <div className="text-xs text-[#64708f] font-medium">
            {totalUsd === null
              ? '—'
              : `$${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          </div>
        </div>
      </div>

      {/* Code section */}
      <div className="px-6 py-7">
        <h2 className="text-lg font-bold text-[#141635] mb-1">Confirm your code</h2>
        <p className="text-sm text-[#64708f] font-medium mb-6">
          Enter this code in your terminal or send it to your agent
        </p>

        {/* Code box */}
        <div className="flex items-center gap-3 border border-[#c8cfe1] hover:border-[#929eba] rounded-2xl px-5 py-4 mb-3 transition-colors">
          <span className="flex-1 text-center text-2xl font-mono font-bold tracking-[0.3em] text-[#141635] select-all">
            {displayCode}
          </span>
          <button
            onClick={handleCopy}
            className="text-[#929eba] hover:text-[#64708f] transition-colors cursor-pointer border-0 bg-transparent p-1 flex-shrink-0"
          >
            {copied ? <Check className="w-4 h-4 text-[#16a34a]" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* Expiry + regenerate */}
        <div className="flex items-center justify-center gap-1.5 text-xs text-[#929eba] font-medium">
          <span>Expires in {timeStr}</span>
          <span>·</span>
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1 text-[#7c3aed] hover:text-[#6d28d9] transition-colors cursor-pointer border-0 bg-transparent font-bold"
          >
            Generate new code
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-[#c8cfe1] px-6 py-3 flex items-center justify-center gap-1.5">
        <span className="text-xs text-[#929eba] font-medium">Powered by</span>
        <img src="/polygon-logo-full.webp" alt="Polygon" className="h-3.5 w-auto opacity-40" />
      </div>
    </div>
  );
}
