import { useEffect, useMemo, useRef, useState } from 'react';
import { encode } from 'uqr';

export const roomLink = (code: string) => `${location.origin}/?room=${code}`;

const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

// Accepts a room link (ours or a bare code); anything else isn't a room.
export function parseRoom(text: string): string | undefined {
  const raw = text.trim().toUpperCase();
  if (CODE.test(raw)) return raw;
  try {
    const code = new URL(text.trim()).searchParams.get('room')?.toUpperCase();
    return code && CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

// One path for all dark modules so the code scales crisply and follows the theme's text color.
export function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const { size, data } = encode(text, { ecc: 'M', border: 0 });
    let path = '';
    data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) path += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size, path };
  }, [text]);
  return (
    <svg
      className="qr-code"
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label="Room QR code"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}

type Detect = (source: HTMLVideoElement) => Promise<string | undefined>;

// The native detector where it exists (Chrome, Android); jsQR on a canvas elsewhere (Safari).
async function detector(): Promise<Detect> {
  const Native = (
    globalThis as {
      BarcodeDetector?: new (o: { formats: string[] }) => {
        detect(s: HTMLVideoElement): Promise<{ rawValue: string }[]>;
      };
    }
  ).BarcodeDetector;
  if (Native) {
    const d = new Native({ formats: ['qr_code'] });
    return async (v) => (await d.detect(v))[0]?.rawValue;
  }
  const { default: jsQR } = await import('jsqr');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return async (v) => {
    // Downscale: decoding a full 1080p frame each tick is wasted work.
    const scale = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
    canvas.width = Math.round(v.videoWidth * scale);
    canvas.height = Math.round(v.videoHeight * scale);
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data;
  };
}

export function Scanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const found = useRef(onCode);
  found.current = onCode;
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (e) {
        if (!stopped)
          setError(
            e instanceof DOMException && e.name === 'NotAllowedError'
              ? 'Camera access was denied. Allow it in your browser settings, or enter the code instead.'
              : 'No camera available. Enter the room code instead.',
          );
        return;
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.srcObject = stream;
      await v.play().catch(() => {});
      const detect = await detector();
      const tick = async () => {
        if (stopped) return;
        if (v.readyState >= 2) {
          const text = await detect(v).catch(() => undefined);
          if (stopped) return;
          if (text !== undefined) {
            const code = parseRoom(text);
            if (code) return found.current(code);
            setInvalid(true);
          }
        }
        timer = setTimeout(tick, 150);
      };
      void tick();
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  if (error) return <p>{error}</p>;
  return (
    <>
      <div className="scanner">
        <video ref={video} muted playsInline />
        <span className="scanner-frame" aria-hidden="true" />
      </div>
      <p className="hint">
        {invalid ? 'That QR code isn’t a CubeRoom room.' : 'Point at a room’s QR code.'}
      </p>
    </>
  );
}
