import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"
import { format, formatDistanceToNow, addHours, addDays, isAfter, isBefore } from "date-fns"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: string | Date) {
  return format(new Date(date), 'EEE, dd/MM/yyyy')
}

export function formatDateTime(date: string | Date) {
  return format(new Date(date), 'EEE, dd/MM/yyyy h:mm a')
}

export function formatTimeAgo(date: string | Date) {
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function generateChallengeCode(seasonNumber: number): string {
  const prefix = `0${seasonNumber}`
  const random = Math.floor(Math.random() * 9000) + 1000
  return `${prefix}-${random}`
}

export function getTierColor(tierName: string): string {
  const colors: Record<string, string> = {
    Diamond: '#06B6D4',
    Platinum: '#64748B',
    Gold: '#F59E0B',
    Silver: '#9CA3AF',
    Bronze: '#F97316',
  }
  return colors[tierName] || '#6B7280'
}

export function getTierBgClass(tierName: string): string {
  const classes: Record<string, string> = {
    Diamond: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
    Platinum: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
    Gold: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    Silver: 'bg-gray-500/10 text-gray-300 border-gray-500/20',
    Bronze: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  }
  return classes[tierName] || 'bg-gray-500/10 text-gray-400'
}

export function getChallengeStatusColor(status: string): string {
  const colors: Record<string, string> = {
    pending: 'text-yellow-400 bg-yellow-400/10',
    scheduled: 'text-green-400 bg-green-400/10',
    played: 'text-blue-400 bg-blue-400/10',
    forfeited: 'text-red-400 bg-red-400/10',
    dissolved: 'text-gray-400 bg-gray-400/10',
  }
  return colors[status] || 'text-gray-400 bg-gray-400/10'
}

export function isDeadlineExpired(deadline: string): boolean {
  return isAfter(new Date(), new Date(deadline))
}

export function hoursUntilDeadline(deadline: string): number {
  const diff = new Date(deadline).getTime() - new Date().getTime()
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60)))
}

export function formatScore(
  set1c: number, set1ch: number,
  set2c: number, set2ch: number,
  stbc?: number, stbch?: number
): string {
  let score = `${set1c}-${set1ch}, ${set2c}-${set2ch}`
  if (stbc !== undefined && stbch !== undefined) {
    score += `, ${stbc}-${stbch}`
  }
  return score
}
