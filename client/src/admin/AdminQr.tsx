import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import type { QrItem } from '../types';

interface QrResponse {
  items: QrItem[];
}

export default function AdminQr() {
  const [items, setItems] = useState<QrItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const load = useCallback(() => {
    api
      .get<QrResponse>('/api/admin/qr')
      .then((res) => {
        setItems(res.items);
        setError(null);
      })
      .catch((err: ApiError) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  function download(item: QrItem) {
    const link = document.createElement('a');
    link.href = item.qr;
    link.download = `endgame-${item.name.toLowerCase().replace(/\s+/g, '-')}-qr.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function copy(item: QrItem) {
    navigator.clipboard
      ?.writeText(item.joinUrl)
      .then(() => {
        setCopied(item.id);
        window.setTimeout(() => setCopied(null), 2000);
      })
      .catch(() => setError('Copy failed. Select the link manually.'));
  }

  function regenerate(item: QrItem) {
    const ok = window.confirm(
      `Regenerate the QR code for ${item.name}?\nThe existing QR code and link will stop working immediately.`,
    );
    if (!ok) return;
    api
      .post('/api/admin/qr/regenerate', { teamId: item.id })
      .then(() => load())
      .catch((err: ApiError) => setError(err.message));
  }

  return (
    <div className="stack stack-wide">
      <div className="row-between">
        <h1 className="title-lg">QR codes</h1>
        <div className="btn-row">
          <button className="btn btn-sm" type="button" onClick={load}>
            Refresh
          </button>
          <button className="btn btn-sm btn-primary" type="button" onClick={() => window.print()}>
            Print all QR codes
          </button>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="qr-grid">
        {items.map((item) => (
          <div className="qr-card" key={item.id}>
            <div className="eyebrow">{item.name}</div>
            <img src={item.qr} alt={`QR code to join ${item.name}`} />
            <div className="qr-instructions">Scan to join {item.name}</div>
            <div className="hint mono" style={{ fontSize: 10, wordBreak: 'break-all', marginTop: 6 }}>
              {item.joinUrl}
            </div>
            <div className="qr-actions no-print">
              <button className="btn btn-sm" type="button" onClick={() => download(item)}>
                Download
              </button>
              <button className="btn btn-sm" type="button" onClick={() => window.print()}>
                Print
              </button>
              <button className="btn btn-sm" type="button" onClick={() => copy(item)}>
                {copied === item.id ? 'Copied' : 'Copy link'}
              </button>
              <button className="btn btn-sm btn-danger" type="button" onClick={() => regenerate(item)}>
                Regenerate
              </button>
            </div>
          </div>
        ))}
      </div>

      <p className="footer-note no-print">
        Each QR encodes a secure random join token. Regenerating a token immediately invalidates the previous code.
      </p>

      <div className="print-sheet">
        <div className="print-title">ENDGAME — Round 1: The Mainframe</div>
        {items.map((item) => (
          <div className="print-qr" key={`print-${item.id}`}>
            <img src={item.qr} alt={`QR code to join ${item.name}`} />
            <div style={{ fontSize: '14pt', fontWeight: 700, marginTop: '3mm' }}>{item.name}</div>
            <div style={{ fontSize: '11pt', marginTop: '2mm' }}>SCAN TO JOIN {item.name.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
