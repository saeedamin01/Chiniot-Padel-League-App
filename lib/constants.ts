export const TIER_CONFIG = {
  diamond: {
    label: 'Diamond',
    icon: '💎',
    color: '#06B6D4',
    bgColor: 'bg-cyan-500/10',
    textColor: 'text-cyan-400',
    borderColor: 'border-cyan-500/30',
  },
  platinum: {
    label: 'Platinum',
    icon: '🔷',
    color: '#64748B',
    bgColor: 'bg-slate-500/10',
    textColor: 'text-slate-300',
    borderColor: 'border-slate-500/30',
  },
  gold: {
    label: 'Gold',
    icon: '🥇',
    color: '#F59E0B',
    bgColor: 'bg-amber-500/10',
    textColor: 'text-amber-400',
    borderColor: 'border-amber-500/30',
  },
  silver: {
    label: 'Silver',
    icon: '🥈',
    color: '#9CA3AF',
    bgColor: 'bg-gray-500/10',
    textColor: 'text-gray-300',
    borderColor: 'border-gray-500/30',
  },
  bronze: {
    label: 'Bronze',
    icon: '🥉',
    color: '#F97316',
    bgColor: 'bg-orange-500/10',
    textColor: 'text-orange-400',
    borderColor: 'border-orange-500/30',
  },
} as const

export const CHALLENGE_STATUS_CONFIG = {
  pending: {
    label: 'Pending',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    badgeVariant: 'pending' as const,
  },
  scheduled: {
    label: 'Scheduled',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    badgeVariant: 'scheduled' as const,
  },
  played: {
    label: 'Played',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    badgeVariant: 'played' as const,
  },
  forfeited: {
    label: 'Forfeited',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    badgeVariant: 'forfeited' as const,
  },
  dissolved: {
    label: 'Dissolved',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/10',
    badgeVariant: 'dissolved' as const,
  },
} as const

export const TEAM_STATUS_CONFIG = {
  available: {
    label: 'Available',
    icon: '✓',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
  },
  frozen: {
    label: 'Frozen',
    icon: '❄️',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
  },
} as const

export const TIER_ORDER = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze'] as const

export const ACTIONS = {
  CHALLENGE_SENT: 'Challenge sent',
  CHALLENGE_ACCEPTED: 'Challenge accepted',
  CHALLENGE_REJECTED: 'Challenge rejected',
  CHALLENGE_FORFEITED: 'Challenge forfeited',
  MATCH_SCHEDULED: 'Match scheduled',
  MATCH_RESULT_REPORTED: 'Match result reported',
  MATCH_RESULT_VERIFIED: 'Match result verified',
  TEAM_FROZEN: 'Team frozen',
  TEAM_UNFROZEN: 'Team unfrozen',
  PROMOTION: 'Team promoted',
  DEMOTION: 'Team demoted',
} as const

export const VALIDATION = {
  CHALLENGE_POSITIONS_ABOVE: 3,
  MIN_TIME_SLOTS: 1,
  MAX_TIME_SLOTS: 3,
  CHALLENGE_ACCEPT_HOURS: 48,
  MATCH_SCHEDULE_HOURS: 48,
  RESULT_REPORT_HOURS: 24,
} as const

export const THEME = {
  colors: {
    background: '#0f172a',
    surface: '#1e293b',
    border: '#334155',
    primary: '#10B981',
    primaryForeground: '#f1f5f9',
    secondary: '#94a3b8',
  },
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
  },
  radius: {
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
  },
} as const
