'use client';

import { JOINTS, type JointKey } from './exercises';

type Props = {
  selected: JointKey[];
  onChange: (next: JointKey[]) => void;
  multi?: boolean;
};

const GROUPS: { label: string; keys: JointKey[] }[] = [
  { label: 'Arms', keys: ['left_shoulder', 'right_shoulder', 'left_elbow', 'right_elbow'] },
  { label: 'Legs', keys: ['left_hip', 'right_hip', 'left_knee', 'right_knee', 'left_ankle', 'right_ankle'] },
];

export function LimbSelector({ selected, onChange, multi = true }: Props) {
  const toggle = (k: JointKey) => {
    const isOn = selected.includes(k);
    if (multi) {
      onChange(isOn ? selected.filter((x) => x !== k) : [...selected, k]);
    } else {
      onChange(isOn ? [] : [k]);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="k-eyebrow" style={{ color: '#6B7785', marginBottom: 6 }}>
            {g.label}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {g.keys.map((k) => {
              const on = selected.includes(k);
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggle(k)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 999,
                    border: on ? '1px solid #1A6B5A' : '1px solid #E5E1D8',
                    background: on ? '#1A6B5A' : '#FFFFFF',
                    color: on ? '#fff' : '#0E1822',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {JOINTS[k].label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
