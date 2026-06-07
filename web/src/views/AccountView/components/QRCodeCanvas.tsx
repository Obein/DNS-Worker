import React, { useRef, useState, useEffect } from "react";

/**
 * Renders a QR code for a given otpauth URI using the `qrcode` package.
 * Dynamically imports to keep bundle small.
 */
export const QRCodeCanvas: React.FC<{ uri: string }> = ({ uri }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!canvasRef.current || !uri) return;
    import("qrcode")
      .then((QRCode) => {
        QRCode.toCanvas(
          canvasRef.current!,
          uri,
          { width: 200, margin: 2, color: { dark: "#1a1a2e", light: "#ffffff" } },
          (err) => {
            if (err) {
              console.error(err);
              setError(true);
            }
          }
        );
      })
      .catch(() => setError(true));
  }, [uri]);

  if (error) {
    return (
      <div className="w-50 h-50 border border-gray-200 rounded-lg flex flex-col items-center justify-center text-center p-4 text-xs text-gray-500">
        <p className="break-all">{uri}</p>
      </div>
    );
  }
  return <canvas ref={canvasRef} className="rounded-lg border border-gray-100" />;
};
