'use client';

import { KINESIS_THEME as T } from './theme';

type Props = {
  current?: number;
  targetMin?: number;
  targetMax?: number;
  max?: number;
  size?: number;
  dark?: boolean;
  label?: string;
  showTicks?: boolean;
};

export function ROMGauge({
  current = 0,
  targetMin = 80,
  targetMax = 150,
  max = 180,
  size = 280,
  dark = false,
  label = 'FLEXION',
  showTicks = true,
}: Props) {
  const cx = size / 2;
  const cy = size * 0.62;
  const r = size * 0.42;
  const stroke = size * 0.04;

  const angToXY = (deg: number): [number, number] => {
    const t = Math.PI - (deg / max) * Math.PI;
    return [cx + r * Math.cos(t), cy - r * Math.sin(t)];
  };
  const arcPath = (a1: number, a2: number) => {
    const [x1, y1] = angToXY(a1);
    const [x2, y2] = angToXY(a2);
    const large = a2 - a1 > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };

  const trackColor = dark ? 'rgba(255,255,255,0.1)' : T.hairline;
  const targetColor = dark ? 'rgba(92,138,110,0.4)' : T.sageLight;
  const arcColor = dark ? '#7AB89A' : T.teal;
  const needleColor = dark ? '#fff' : T.ink;
  const labelColor = dark ? 'rgba(255,255,255,0.55)' : T.inkMute;
  const valueColor = dark ? '#fff' : T.ink;

  const safe = Math.max(0, Math.min(max, current));
  const [nx, ny] = angToXY(safe);

  return (
    <svg
      width={size}
      height={size * 0.78}
      viewBox={`0 0 ${size} ${size * 0.78}`}
      style={{ overflow: 'visible' }}
    >
      <path d={arcPath(0, max)} stroke={trackColor} strokeWidth={stroke} fill="none" strokeLinecap="round" />
      <path d={arcPath(targetMin, targetMax)} stroke={targetColor} strokeWidth={stroke} fill="none" strokeLinecap="round" />
      <path d={arcPath(0, safe)} stroke={arcColor} strokeWidth={stroke} fill="none" strokeLinecap="round" />

      {showTicks &&
        [0, 30, 60, 90, 120, 150, 180]
          .filter((a) => a <= max)
          .map((a) => {
            const [tx1, ty1] = angToXY(a);
            const t = Math.PI - (a / max) * Math.PI;
            const tx2 = cx + (r + stroke * 1.2) * Math.cos(t);
            const ty2 = cy - (r + stroke * 1.2) * Math.sin(t);
            const lx = cx + (r + stroke * 2.6) * Math.cos(t);
            const ly = cy - (r + stroke * 2.6) * Math.sin(t);
            return (
              <g key={a}>
                <line x1={tx1} y1={ty1} x2={tx2} y2={ty2} stroke={labelColor} strokeWidth={1} />
                <text
                  x={lx}
                  y={ly}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="k-mono"
                  style={{ fontSize: 9, fill: labelColor }}
                >
                  {a}°
                </text>
              </g>
            );
          })}

      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth={2.2} strokeLinecap="round" />
      <circle cx={cx} cy={cy} r={5} fill={needleColor} />
      <circle cx={cx} cy={cy} r={2} fill={dark ? T.night : T.paper} />

      <text
        x={cx}
        y={cy - r * 0.55}
        textAnchor="middle"
        className="k-serif"
        style={{
          fontSize: size * 0.22,
          fontWeight: 400,
          fill: valueColor,
          letterSpacing: '-0.02em',
        }}
      >
        {Math.round(current)}°
      </text>
      <text
        x={cx}
        y={cy - r * 0.3}
        textAnchor="middle"
        className="k-eyebrow"
        style={{ fontSize: 9, fill: labelColor }}
      >
        {label}
      </text>
    </svg>
  );
}
