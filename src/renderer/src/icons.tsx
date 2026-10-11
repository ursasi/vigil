import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 20, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...rest
  }
}

/** The Vigil mark — a watchful eye. */
export function IconEye(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })} fill="none">
      <path d="M2 12c2.6-4.2 6-6.3 10-6.3S19.4 7.8 22 12c-2.6 4.2-6 6.3-10 6.3S4.6 16.2 2 12Z" />
      <circle cx="12" cy="12" r="2.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function IconLaptop(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <rect x="3.5" y="5" width="17" height="11" rx="1.8" />
      <path d="M2 19.5h20" />
    </svg>
  )
}

export function IconServer(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <rect x="3" y="4" width="18" height="6.5" rx="1.8" />
      <rect x="3" y="13.5" width="18" height="6.5" rx="1.8" />
      <circle cx="7" cy="7.25" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="7" cy="16.75" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Jump host / relay node. */
export function IconRelay(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <circle cx="6" cy="12" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="18" cy="18" r="2.4" />
      <path d="M8.1 10.9 15.9 7.1M8.1 13.1l7.8 3.8" />
    </svg>
  )
}

export function IconArrowRight(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M4 12h15M13 6l6 6-6 6" />
    </svg>
  )
}

export function IconArrowLeft(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M20 12H5M11 6l-6 6 6 6" />
    </svg>
  )
}

export function IconGlobe(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.5 18.4 12 21c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
  )
}

export function IconLink(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" />
    </svg>
  )
}

export function IconAlert(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M12 3.5 21 19.5H3L12 3.5Z" />
      <path d="M12 10v4M12 17.2v.1" />
    </svg>
  )
}

export function IconInfo(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.1" />
    </svg>
  )
}

export function IconRefresh(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M20 11a8 8 0 0 0-13.7-5.3L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 13.7 5.3L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  )
}

export function IconFolder(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

export function IconPower(props: IconProps): JSX.Element {
  return (
    <svg {...base({ ...props })}>
      <path d="M12 3v9" />
      <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
    </svg>
  )
}
