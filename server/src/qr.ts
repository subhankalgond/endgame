import QRCode from 'qrcode';

/** Render a join URL as a PNG data URL (the only QR source used by the app). */
export function renderQr(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 640,
    color: { dark: '#111111', light: '#ffffff' },
  });
}
