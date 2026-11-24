/**
 * Simple drawings for the six install steps (spec 019, research R11): drawn,
 * not screenshots, so no one's browser or data is ever shown, they suit light
 * and dark themes (currentColor), and they don't go stale when Chrome changes.
 */

const frame = "fill-none stroke-current";

function Svg({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 160 90"
      role="img"
      aria-label={label}
      className="h-auto w-full max-w-[200px] text-muted-foreground"
    >
      {children}
    </svg>
  );
}

/** A browser window with an address bar, for steps that happen in Chrome. */
function Window({ address }: { address?: string }) {
  return (
    <>
      <rect x="6" y="6" width="148" height="78" rx="6" className={frame} strokeWidth="2" />
      <line x1="6" y1="22" x2="154" y2="22" className="stroke-current" strokeWidth="2" />
      <circle cx="16" cy="14" r="2.5" className="fill-current" />
      <circle cx="24" cy="14" r="2.5" className="fill-current" />
      <circle cx="32" cy="14" r="2.5" className="fill-current" />
      {address && (
        <>
          <rect x="42" y="9" width="104" height="10" rx="5" className={frame} strokeWidth="1.5" />
          <text x="48" y="17" fontSize="7" className="fill-current">
            {address}
          </text>
        </>
      )}
    </>
  );
}

export function UnzipArt() {
  return (
    <Svg label="A zip file opening into a folder">
      <rect x="18" y="24" width="38" height="48" rx="4" className={frame} strokeWidth="2" />
      <path d="M37 24v48" className="stroke-current" strokeWidth="2" strokeDasharray="4 3" />
      <text x="25" y="84" fontSize="8" className="fill-current">.zip</text>
      <path d="M66 48h22m-6-6 6 6-6 6" className={frame} strokeWidth="2" />
      <path
        d="M98 30h18l6 6h22a4 4 0 0 1 4 4v28a4 4 0 0 1-4 4H98a4 4 0 0 1-4-4V34a4 4 0 0 1 4-4z"
        className="fill-primary/15 stroke-primary"
        strokeWidth="2"
      />
      <text x="100" y="84" fontSize="8" className="fill-current">Job Catcher</text>
    </Svg>
  );
}

export function AddressArt() {
  return (
    <Svg label="Chrome with chrome://extensions in the address bar">
      <Window address="chrome://extensions" />
      <rect x="16" y="32" width="60" height="8" rx="2" className="fill-current opacity-30" />
      <rect x="16" y="46" width="128" height="14" rx="3" className={frame} strokeWidth="1.5" />
      <rect x="16" y="64" width="128" height="14" rx="3" className={frame} strokeWidth="1.5" />
    </Svg>
  );
}

export function DevModeArt() {
  return (
    <Svg label="The Developer mode switch turned on, top right">
      <Window address="chrome://extensions" />
      <text x="70" y="40" fontSize="8" className="fill-current">Developer mode</text>
      <rect x="128" y="32" width="20" height="11" rx="5.5" className="fill-primary" />
      <circle cx="142.5" cy="37.5" r="4" className="fill-background" />
      <circle cx="138" cy="37.5" r="13" className="fill-none stroke-primary" strokeWidth="1.5" strokeDasharray="3 3" />
    </Svg>
  );
}

export function LoadUnpackedArt() {
  return (
    <Svg label="The Load unpacked button, then pick the Job Catcher folder">
      <Window address="chrome://extensions" />
      <rect x="14" y="30" width="46" height="13" rx="3" className="fill-primary/15 stroke-primary" strokeWidth="1.5" />
      <text x="18" y="39" fontSize="7" className="fill-current">Load unpacked</text>
      <path
        d="M92 54h12l4 4h28a3 3 0 0 1 3 3v14a3 3 0 0 1-3 3H92a3 3 0 0 1-3-3V57a3 3 0 0 1 3-3z"
        className="fill-primary/15 stroke-primary"
        strokeWidth="1.5"
      />
      <path d="M60 46c14 4 22 8 28 14" className={frame} strokeWidth="1.5" strokeDasharray="3 3" />
    </Svg>
  );
}

export function PinArt() {
  return (
    <Svg label="The puzzle-piece menu with a pin next to Job Catcher">
      <Window />
      <path
        d="M124 10h4a2 2 0 0 1 4 0h4v4a2 2 0 0 1 0 4v4h-4a2 2 0 0 0-4 0h-4z"
        className="fill-current"
      />
      <rect x="70" y="28" width="78" height="40" rx="4" className="fill-background stroke-current" strokeWidth="1.5" />
      <rect x="76" y="36" width="10" height="10" rx="2" className="fill-primary" />
      <text x="90" y="44" fontSize="7" className="fill-current">Job Catcher</text>
      <path d="M138 36l4 4-3 1-2 4-2-2-4 4-1-1 4-4-2-2 4-2z" className="fill-primary" />
      <rect x="76" y="52" width="10" height="10" rx="2" className="fill-current opacity-30" />
      <rect x="90" y="55" width="40" height="4" rx="2" className="fill-current opacity-30" />
    </Svg>
  );
}

export function ConnectArt() {
  return (
    <Svg label="Job Catcher's side panel with the Connect to Job Enhancer button">
      <Window />
      <line x1="100" y1="22" x2="100" y2="84" className="stroke-current" strokeWidth="2" />
      <rect x="14" y="32" width="76" height="6" rx="2" className="fill-current opacity-30" />
      <rect x="14" y="44" width="60" height="6" rx="2" className="fill-current opacity-30" />
      <rect x="106" y="30" width="42" height="6" rx="2" className="fill-current opacity-50" />
      <rect x="106" y="46" width="42" height="14" rx="3" className="fill-primary" />
      <text x="110" y="55" fontSize="5.5" className="fill-primary-foreground">Connect</text>
    </Svg>
  );
}
