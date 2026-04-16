'use client'

import React from 'react'
import { TierBadge } from '@/components/ui/tier-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export interface LadderEntry {
  id: string
  rank: number
  teamName: string
  players: string[]
  tier: 'Diamond' | 'Platinum' | 'Gold' | 'Silver' | 'Bronze'
  status: 'available' | 'frozen'
  activeChallenge?: string
  wins: number
  losses: number
  isMyTeam?: boolean
}

interface LadderTableProps {
  entries: LadderEntry[]
  onRowClick?: (entry: LadderEntry) => void
}

const getTierColor = (tier: string) => {
  const colors: Record<string, string> = {
    Diamond: 'from-cyan-400 to-blue-500',
    Platinum: 'from-slate-300 to-slate-500',
    Gold: 'from-amber-400 to-orange-500',
    Silver: 'from-gray-300 to-gray-500',
    Bronze: 'from-orange-400 to-orange-600',
  }
  return colors[tier] || colors.Silver
}

export function LadderTable({ entries, onRowClick }: LadderTableProps) {
  const groupedByTier = entries.reduce(
    (acc, entry) => {
      if (!acc[entry.tier]) {
        acc[entry.tier] = []
      }
      acc[entry.tier].push(entry)
      return acc
    },
    {} as Record<string, LadderEntry[]>
  )

  const tierOrder = ['Diamond', 'Platinum', 'Gold', 'Silver', 'Bronze']
  const sortedTiers = tierOrder.filter((tier) => groupedByTier[tier])

  return (
    <div className="space-y-8">
      {sortedTiers.map((tier) => {
        const tierEntries = groupedByTier[tier]
        const gradient = getTierColor(tier)

        return (
          <div key={tier} className="space-y-4">
            {/* Tier Header */}
            <div
              className={`bg-gradient-to-r ${gradient} rounded-lg p-4 shadow-lg`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <TierBadge tier={tier} size="lg" />
                  <h2 className="text-xl font-bold text-slate-950">
                    {tier} Tier
                  </h2>
                </div>
                <p className="text-sm font-semibold text-slate-950">
                  {tierEntries.length} {tierEntries.length === 1 ? 'team' : 'teams'}
                </p>
              </div>
            </div>

            {/* Tier Table */}
            <Card className="overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">Rank</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="hidden sm:table-cell">Players</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Challenge</TableHead>
                    <TableHead className="text-right">Record</TableHead>
                    <TableHead className="text-right w-16">Win%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tierEntries.map((entry, index) => {
                    const winPercentage =
                      entry.wins + entry.losses > 0
                        ? ((entry.wins / (entry.wins + entry.losses)) * 100).toFixed(1)
                        : '0.0'
                    const isPrizePosition = index < 2

                    return (
                      <TableRow
                        key={entry.id}
                        onClick={() => onRowClick?.(entry)}
                        className={`cursor-pointer transition-colors ${
                          entry.isMyTeam
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/20'
                            : isPrizePosition
                            ? 'bg-slate-700/30 hover:bg-slate-700/50'
                            : 'hover:bg-slate-800/50'
                        }`}
                      >
                        <TableCell className="font-bold text-slate-100">
                          {entry.rank}
                          {isPrizePosition && (
                            <span className="ml-1 text-lg">
                              {index === 0 ? '🥇' : '🥈'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="font-semibold text-slate-100">
                              {entry.teamName}
                              {entry.isMyTeam && (
                                <span className="ml-2 text-emerald-400 text-xs font-bold">
                                  (MY TEAM)
                                </span>
                              )}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-slate-400 text-sm">
                          {entry.players.slice(0, 2).join(', ')}
                          {entry.players.length > 2 && (
                            <span className="text-slate-500">
                              {' '}
                              +{entry.players.length - 2}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={entry.status === 'available' ? 'available' : 'frozen'}
                            className="text-xs"
                          >
                            {entry.status === 'frozen' && '❄️ '}
                            {entry.status === 'available' ? 'Available' : 'Frozen'}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-slate-400 text-sm">
                          {entry.activeChallenge ? (
                            <Badge variant="scheduled" className="text-xs">
                              {entry.activeChallenge}
                            </Badge>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-slate-100">
                          {entry.wins}–{entry.losses}
                        </TableCell>
                        <TableCell className="text-right font-bold text-emerald-400">
                          {winPercentage}%
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Card>
          </div>
        )
      })}
    </div>
  )
}
